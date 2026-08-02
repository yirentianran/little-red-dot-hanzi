import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

import practiceEngineModule from '../js/practice-engine.js';

const { createPracticeEngine } = practiceEngineModule;

class FakeElement {
  constructor(name, ownerDocument) {
    this.name = name;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.style = { position: '' };
    this.listeners = new Map();
    this.rect = { width: 320, height: 280 };
  }

  setAttributeNS(_namespace, name, value) { this.attributes.set(name, String(value)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  getBoundingClientRect() { return { ...this.rect }; }
  addEventListener(type, callback, options) {
    const entries = this.listeners.get(type) || [];
    entries.push({ callback, options });
    this.listeners.set(type, entries);
  }
  removeEventListener(type, callback, options) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter((entry) => entry.callback !== callback || entry.options !== options));
  }
  dispatch(type, fields = {}) {
    for (const { callback } of [...(this.listeners.get(type) || [])]) callback({ type, ...fields });
  }
  queryByClass(className) {
    const results = [];
    const visit = (node) => {
      if ((node.getAttribute?.('class') || '').split(' ').includes(className)) results.push(node);
      node.children?.forEach(visit);
    };
    visit(this);
    return results;
  }
}

function createDocument() {
  return {
    listeners: new Map(),
    defaultView: {
      getComputedStyle(target) {
        return {
          position: target.computedPosition ?? 'static',
          borderLeftWidth: target.computedBorderWidth ?? '',
          borderRightWidth: target.computedBorderWidth ?? '',
          borderTopWidth: target.computedBorderWidth ?? '',
          borderBottomWidth: target.computedBorderWidth ?? ''
        };
      }
    },
    createElementNS(_namespace, name) { return new FakeElement(name, this); },
    addEventListener(type, callback, options) {
      const entries = this.listeners.get(type) || [];
      entries.push({ callback, options });
      this.listeners.set(type, entries);
    },
    removeEventListener(type, callback, options) {
      const entries = this.listeners.get(type) || [];
      this.listeners.set(type, entries.filter((entry) => entry.callback !== callback || entry.options !== options));
    }
  };
}

function createTimers() {
  let nextId = 1;
  const pending = new Map();
  const all = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      const timer = { callback, delay };
      pending.set(id, timer);
      all.set(id, timer);
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    pending,
    run(id) { const timer = pending.get(id); pending.delete(id); timer?.callback(); },
    runCleared(id) { all.get(id)?.callback(); }
  };
}

function createHarness(overrides = {}) {
  const document = createDocument();
  const target = new FakeElement('div', document);
  target.computedPosition = overrides.computedPosition ?? 'static';
  target.computedBorderWidth = overrides.computedBorderWidth;
  const events = [];
  const calls = {
    create: [], quiz: [], cancelQuiz: 0, outline: [], highlight: [], dimensions: [], transforms: [],
    installedQuiz: null
  };
  const baseWriter = {
    quiz(options) {
      if (overrides.deferredOperations) {
        return Promise.resolve().then(() => {
          calls.quiz.push(options);
          calls.installedQuiz = options;
        });
      }
      calls.quiz.push(options);
      calls.installedQuiz = options;
    },
    cancelQuiz() { calls.cancelQuiz += 1; calls.installedQuiz = null; },
    highlightStroke(strokeNum) { calls.highlight.push(strokeNum); },
    updateDimensions(options) { calls.dimensions.push(options); },
    showOutline(options) {
      calls.outline.push(['show', options]);
      return overrides.deferredOperations ? Promise.resolve() : undefined;
    },
    hideOutline(options) {
      calls.outline.push(['hide', options]);
      return overrides.deferredOperations ? Promise.resolve() : undefined;
    }
  };
  const writer = { ...baseWriter, ...overrides.writer };
  const writerMouseUp = () => {};
  const writerTouchEnd = () => {};
  const HanziWriter = {
    create(...args) {
      calls.create.push(args);
      const [host] = args;
      host.appendChild(new FakeElement('svg', document));
      document.addEventListener('mouseup', writerMouseUp);
      document.addEventListener('touchend', writerTouchEnd);
      if (overrides.createError) throw overrides.createError;
      return writer;
    },
    getScalingTransform(width, height, padding) {
      calls.transforms.push([width, height, padding]);
      return { x: 1, y: 2, scale: 0.25, transform: `translate(${width} ${height}) scale(.25 -.25)` };
    }
  };
  const timers = createTimers();
  const geometry = {
    strokeCount: 2,
    strokes: ['M 0 0 L 1 1', 'M 2 2 L 3 3'],
    medians: [[[10, 20], [30, 40]], [[50, 60], [70, 80]]]
  };
  const options = {
    target,
    HanziWriter,
    character: '潮',
    geometry,
    onEvent(event) { events.push(event); },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    ...overrides.options
  };
  const originalDocumentAdd = document.addEventListener;
  const engine = createPracticeEngine(options);
  return {
    calls, document, engine, events, geometry, HanziWriter, options, target, timers, writer,
    originalDocumentAdd, writerMouseUp, writerTouchEnd
  };
}

async function flushMicrotasks(turns = 12) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((settle, fail) => { resolve = settle; reject = fail; });
  return { promise, resolve, reject };
}

function throwingThen(error) {
  return Object.defineProperty({}, 'then', { get() { throw error; } });
}

function dot(target) { return target.queryByClass('practice-start-dot')[0]; }
function errorPath(target) { return target.queryByClass('practice-error-path')[0]; }
function validStrokeData(overrides = {}) {
  return {
    strokeNum: 0,
    mistakesOnStroke: 1,
    totalMistakes: 2,
    strokesRemaining: 1,
    drawnPath: { pathString: 'M1 2 L3 4', points: [{ x: 1, y: 2 }] },
    isBackwards: false,
    ...overrides
  };
}

function withoutField(value, field) {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

function withHostileField(value, field) {
  const copy = { ...value };
  Object.defineProperty(copy, field, {
    enumerable: true,
    get() { assert.fail(`${field} accessor invoked`); }
  });
  return copy;
}

test('creates one writer with exact local data and a separate pointer-transparent overlay', () => {
  const { calls, geometry, target } = createHarness();
  assert.equal(calls.create.length, 1);
  const [writerTarget, character, options] = calls.create[0];
  assert.notEqual(writerTarget, target);
  assert.equal(writerTarget.parentNode, target);
  assert.equal(writerTarget.getAttribute('class'), 'practice-writer-host');
  assert.equal(character, '潮');
  assert.deepEqual({ ...options, charDataLoader: undefined }, {
    width: 320, height: 280, padding: 0,
    showCharacter: false, showOutline: true,
    outlineColor: '#dce7ef', drawingColor: '#1769aa',
    strokeColor: '#20252b', highlightColor: '#d92d20',
    acceptBackwardsStrokes: false, leniency: 1, highlightOnComplete: false,
    charDataLoader: undefined
  });
  let callbackCalls = 0;
  const loaded = options.charDataLoader(
    '潮',
    () => { callbackCalls += 1; },
    () => assert.fail('local loader failed')
  );
  assert.equal(callbackCalls, 0);
  assert.deepEqual(loaded, { strokes: geometry.strokes, medians: geometry.medians });
  assert.deepEqual(Object.keys(loaded), ['strokes', 'medians']);
  assert.notEqual(loaded.strokes, geometry.strokes);
  assert.notEqual(loaded.medians, geometry.medians);
  assert.equal(Object.isFrozen(loaded), true);
  assert.notEqual(options.charDataLoader('潮'), loaded);
  assert.equal(target.children.length, 3);
  const grid = target.children[0];
  assert.equal(grid.getAttribute('class'), 'practice-grid');
  assert.equal(grid.getAttribute('viewBox'), '0 0 1024 1024');
  assert.equal(grid.getAttribute('preserveAspectRatio'), 'xMidYMid meet');
  assert.equal(grid.getAttribute('aria-hidden'), 'true');
  assert.equal(grid.style.pointerEvents, 'none');
  assert.equal(grid.queryByClass('hanzi-grid__border').length, 1);
  assert.equal(grid.queryByClass('hanzi-grid__axis').length, 2);
  assert.equal(grid.queryByClass('hanzi-grid__diagonal').length, 2);
  assert.equal(target.children[1], writerTarget);
  const overlay = target.children.at(-1);
  assert.equal(overlay.name, 'svg');
  assert.equal(overlay.style.pointerEvents, 'none');
  assert.equal(overlay.style.position, 'absolute');
  assert.equal(target.style.position, 'relative');
  assert.equal(dot(target).getAttribute('visibility'), 'hidden');
});

test('uses the target content box so the writer matches the learning SVG inside the border', () => {
  const { calls } = createHarness({ computedBorderWidth: '2px' });
  const options = calls.create[0][2];
  assert.deepEqual(
    { width: options.width, height: options.height, padding: options.padding },
    { width: 316, height: 276, padding: 0 }
  );
  assert.deepEqual(calls.transforms[0], [316, 276, 0]);
});

test('guided and independent starts use exact outline and quiz options', () => {
  const { calls, engine } = createHarness();
  engine.start({ phase: 'guided', strokeIndex: 1 });
  assert.deepEqual(calls.outline, [['show', { duration: 0 }]]);
  assert.equal(calls.quiz.length, 1);
  const guided = calls.quiz[0];
  assert.deepEqual({ ...guided, onCorrectStroke: null, onMistake: null, onComplete: null }, {
    quizStartStrokeNum: 1, showHintAfterMisses: 2, acceptBackwardsStrokes: false,
    leniency: 1, highlightOnComplete: false,
    onCorrectStroke: null, onMistake: null, onComplete: null
  });
  assert.equal(typeof guided.onCorrectStroke, 'function');
  engine.start({ phase: 'independent', strokeIndex: 0 });
  assert.deepEqual(calls.outline.at(-1), ['hide', { duration: 0 }]);
  assert.equal(calls.cancelQuiz, 1);
});

test('promise-deferred activation cannot survive cancellation or destruction', async (t) => {
  await t.test('start then immediate cancel', async () => {
    const { calls, engine } = createHarness({ deferredOperations: true });
    engine.start({ phase: 'guided', strokeIndex: 0 });
    engine.cancel();
    await flushMicrotasks();
    assert.equal(calls.installedQuiz, null);
    assert.equal(calls.quiz.length, 0);
  });

  await t.test('start then immediate destroy', async () => {
    const { calls, engine } = createHarness({ deferredOperations: true });
    engine.start({ phase: 'guided', strokeIndex: 0 });
    engine.destroy();
    await flushMicrotasks();
    assert.equal(calls.installedQuiz, null);
    assert.equal(calls.quiz.length, 0);
  });

  await t.test('rapid replacement then cancel', async () => {
    const { calls, engine } = createHarness({ deferredOperations: true });
    engine.start({ phase: 'guided', strokeIndex: 0 });
    engine.start({ phase: 'independent', strokeIndex: 1 });
    engine.cancel();
    await flushMicrotasks();
    assert.equal(calls.installedQuiz, null);
    assert.equal(calls.quiz.length, 0);
  });
});

test('serialized promise activation leaves only the latest quiz installed', async () => {
  const { calls, engine } = createHarness({ deferredOperations: true });
  engine.start({ phase: 'guided', strokeIndex: 0 });
  engine.start({ phase: 'independent', strokeIndex: 1 });
  await flushMicrotasks();
  assert.equal(calls.quiz.length, 1);
  assert.equal(calls.installedQuiz, calls.quiz[0]);
  assert.equal(calls.installedQuiz.quizStartStrokeNum, 1);
  assert.deepEqual(calls.outline.at(-1), ['hide', { duration: 0 }]);
});

test('exposes public busy state until the owned quiz activation fulfills', async () => {
  const { engine, target } = createHarness({ deferredOperations: true });
  engine.start({ phase: 'guided', strokeIndex: 0 });
  assert.equal(target.getAttribute('aria-busy'), 'true');
  await flushMicrotasks();
  assert.equal(target.getAttribute('aria-busy'), 'false');
});

test('stale activation cannot clear busy state for a replacement quiz', async () => {
  const firstOutline = deferred();
  const secondOutline = deferred();
  const firstQuiz = deferred();
  const secondQuiz = deferred();
  let outlineCalls = 0;
  let quizCalls = 0;
  const { engine, target } = createHarness({
    writer: {
      showOutline() {
        outlineCalls += 1;
        return outlineCalls === 1 ? firstOutline.promise : secondOutline.promise;
      },
      quiz() {
        quizCalls += 1;
        return quizCalls === 1 ? firstQuiz.promise : secondQuiz.promise;
      }
    }
  });
  engine.start({ phase: 'guided', strokeIndex: 0 });
  firstOutline.resolve();
  await flushMicrotasks();
  assert.equal(quizCalls, 1);
  engine.restart();
  firstQuiz.resolve();
  await flushMicrotasks();
  assert.equal(outlineCalls, 2);
  assert.equal(target.getAttribute('aria-busy'), 'true');
  secondOutline.resolve();
  await flushMicrotasks();
  assert.equal(quizCalls, 2);
  assert.equal(target.getAttribute('aria-busy'), 'true');
  secondQuiz.resolve();
  await flushMicrotasks();
  assert.equal(target.getAttribute('aria-busy'), 'false');
});

test('destroy removes busy state and stale activation cannot restore it', async () => {
  const outline = deferred();
  const { engine, target } = createHarness({
    writer: { showOutline() { return outline.promise; } }
  });
  engine.start({ phase: 'guided', strokeIndex: 0 });
  assert.equal(target.getAttribute('aria-busy'), 'true');
  engine.destroy();
  assert.equal(target.getAttribute('aria-busy'), null);
  outline.resolve();
  await flushMicrotasks();
  assert.equal(target.getAttribute('aria-busy'), null);
});

test('owned activation failures deactivate the board and notify onError exactly once', async (t) => {
  const cases = [
    ['showOutline synchronous throw', 'guided', 'outline', (error) => { throw error; }],
    ['hideOutline synchronous throw', 'independent', 'outline', (error) => { throw error; }],
    ['outline then getter throw', 'guided', 'outline', (error) => throwingThen(error)],
    ['outline promise rejection', 'guided', 'outline', (error) => Promise.reject(error)],
    ['quiz synchronous throw', 'guided', 'quiz', (error) => { throw error; }],
    ['quiz then getter throw', 'guided', 'quiz', (error) => throwingThen(error)],
    ['quiz promise rejection', 'guided', 'quiz', (error) => Promise.reject(error)]
  ];

  for (const [name, phase, operation, fail] of cases) {
    await t.test(name, async () => {
      const failure = new Error(name);
      const errors = [];
      const writer = operation === 'outline'
        ? { [phase === 'guided' ? 'showOutline' : 'hideOutline']() { return fail(failure); } }
        : { quiz() { return fail(failure); } };
      const harness = createHarness({
        writer,
        options: { onError(error) { errors.push(error); } }
      });

      assert.doesNotThrow(() => harness.engine.start({ phase, strokeIndex: 0 }));
      await flushMicrotasks();

      assert.deepEqual(errors, [failure]);
      assert.equal(harness.target.getAttribute('aria-busy'), 'false');
      assert.equal(dot(harness.target).getAttribute('visibility'), 'hidden');
      assert.throws(() => harness.engine.restart(), /must be active/);
      if (operation === 'outline') assert.equal(harness.calls.quiz.length, 0);
    });
  }
});

test('onError is optional, validated, and observer exceptions are contained', async () => {
  const withoutObserver = createHarness({
    writer: { showOutline() { throw new Error('outline failed'); } }
  });
  assert.doesNotThrow(() => withoutObserver.engine.start({ phase: 'guided', strokeIndex: 0 }));
  assert.equal(withoutObserver.target.getAttribute('aria-busy'), 'false');

  const throwingObserver = createHarness({
    writer: { showOutline() { return Promise.reject(new Error('outline rejected')); } },
    options: { onError() { throw new Error('observer failed'); } }
  });
  throwingObserver.engine.start({ phase: 'guided', strokeIndex: 0 });
  await flushMicrotasks();
  assert.equal(throwingObserver.target.getAttribute('aria-busy'), 'false');
  assert.throws(() => createPracticeEngine({ ...throwingObserver.options, onError: true }), /options\.onError/);
});

test('stale activation failure cannot notify or clear replacement busy state', async () => {
  const firstQuiz = deferred();
  const replacementOutline = deferred();
  let outlineCalls = 0;
  const errors = [];
  const harness = createHarness({
    writer: {
      showOutline() {
        outlineCalls += 1;
        return outlineCalls === 1 ? undefined : replacementOutline.promise;
      },
      quiz() { return firstQuiz.promise; }
    },
    options: { onError(error) { errors.push(error); } }
  });
  harness.engine.start({ phase: 'guided', strokeIndex: 0 });
  harness.engine.restart();
  const staleFailure = new Error('stale quiz rejected');
  firstQuiz.reject(staleFailure);
  await flushMicrotasks();

  assert.equal(harness.target.getAttribute('aria-busy'), 'true');
  assert.deepEqual(errors, []);
  assert.equal(outlineCalls, 2);
});

test('owned failure becomes inactive before cancelQuiz can invoke writer callbacks', async () => {
  const failure = new Error('quiz rejected');
  const errors = [];
  let quizOptions;
  const harness = createHarness({
    writer: {
      quiz(options) {
        quizOptions = options;
        return Promise.reject(failure);
      },
      cancelQuiz() {
        quizOptions.onComplete({ totalMistakes: 0 });
      }
    },
    options: { onError(error) { errors.push(error); } }
  });
  harness.engine.start({ phase: 'guided', strokeIndex: 0 });
  await flushMicrotasks();

  assert.deepEqual(harness.events, []);
  assert.deepEqual(errors, [failure]);
  assert.equal(harness.target.getAttribute('aria-busy'), 'false');
  assert.equal(dot(harness.target).getAttribute('visibility'), 'hidden');
});

test('owns writer host and known 3.7.3 document listeners until destroy; browser runtime rechecks in Task 9', () => {
  const { calls, document, engine, originalDocumentAdd, target } = createHarness();
  assert.equal(document.addEventListener, originalDocumentAdd);
  assert.equal(document.listeners.get('mouseup').length, 1);
  assert.equal(document.listeners.get('touchend').length, 1);
  assert.equal(target.children.length, 3);

  engine.destroy();

  assert.equal(calls.cancelQuiz, 1);
  assert.equal(target.children.length, 0);
  assert.equal(document.listeners.get('mouseup').length, 0);
  assert.equal(document.listeners.get('touchend').length, 0);
  assert.equal(document.addEventListener, originalDocumentAdd);
});

test('callbacks emit detached frozen events and update dot and mistake path', () => {
  const { calls, engine, events, target } = createHarness();
  engine.start({ phase: 'guided', strokeIndex: 0 });
  assert.equal(dot(target).getAttribute('cx'), '10');
  const correctData = { strokeNum: 0, mistakesOnStroke: 1, totalMistakes: 2, strokesRemaining: 1,
    drawnPath: { pathString: 'M1 2 L3 4', points: [{ x: 1, y: 2 }] }, isBackwards: false };
  calls.quiz[0].onCorrectStroke(correctData);
  assert.equal(dot(target).getAttribute('cx'), '50');
  assert.deepEqual(events[0], {
    type: 'stroke-correct', strokeNum: 0, mistakesOnStroke: 1, totalMistakes: 2, strokesRemaining: 1,
    drawnPath: { pathString: 'M1 2 L3 4', points: [{ x: 1, y: 2 }] }
  });
  assert.equal(Object.isFrozen(events[0]), true);
  assert.equal(Object.isFrozen(events[0].drawnPath.points[0]), true);
  correctData.drawnPath.points[0].x = 99;
  assert.equal(events[0].drawnPath.points[0].x, 1);

  const mistakeData = { strokeNum: 1, mistakesOnStroke: 2, totalMistakes: 3, strokesRemaining: 1,
    isBackwards: true, drawnPath: { pathString: 'M8 9 L10 11', points: [{ x: 8, y: 9 }] } };
  calls.quiz[0].onMistake(mistakeData);
  assert.equal(errorPath(target).getAttribute('d'), 'M8 9 L10 11');
  assert.equal(errorPath(target).getAttribute('stroke'), '#d92d20');
  assert.equal(events[1].isBackwards, true);
  calls.quiz[0].onComplete({ character: '潮', totalMistakes: 3 });
  assert.equal(dot(target).getAttribute('visibility'), 'hidden');
  assert.deepEqual(events[2], { type: 'character-complete', totalMistakes: 3 });
});

test('observer exceptions are contained after coherent correct, mistake, and complete state', async (t) => {
  await t.test('correct', () => {
    const { calls, engine, target } = createHarness({ options: { onEvent() { throw new Error('observer'); } } });
    engine.start({ phase: 'guided', strokeIndex: 0 });
    assert.doesNotThrow(() => calls.quiz[0].onCorrectStroke(validStrokeData()));
    assert.equal(dot(target).getAttribute('cx'), '50');
  });
  await t.test('mistake', () => {
    const { calls, engine, target } = createHarness({ options: { onEvent() { throw new Error('observer'); } } });
    engine.start({ phase: 'guided', strokeIndex: 0 });
    assert.doesNotThrow(() => calls.quiz[0].onMistake(validStrokeData({ isBackwards: true })));
    assert.equal(errorPath(target).getAttribute('d'), 'M1 2 L3 4');
  });
  await t.test('complete', () => {
    const { calls, engine, target } = createHarness({ options: { onEvent() { throw new Error('observer'); } } });
    engine.start({ phase: 'guided', strokeIndex: 0 });
    assert.doesNotThrow(() => calls.quiz[0].onComplete({ totalMistakes: 2 }));
    assert.equal(dot(target).getAttribute('visibility'), 'hidden');
  });
});

test('observer reentrancy preserves revision-owned DOM and lifecycle state', async (t) => {
  await t.test('correct observer restarts', () => {
    let reentrantEngine;
    const harness = createHarness({ options: { onEvent() { reentrantEngine.restart(); } } });
    reentrantEngine = harness.engine;
    harness.engine.start({ phase: 'guided', strokeIndex: 0 });
    harness.calls.quiz[0].onCorrectStroke(validStrokeData());
    assert.equal(harness.calls.quiz.at(-1).quizStartStrokeNum, 0);
    assert.equal(dot(harness.target).getAttribute('cx'), '10');
  });
  await t.test('mistake observer cancels', () => {
    let reentrantEngine;
    const harness = createHarness({ options: { onEvent() { reentrantEngine.cancel(); } } });
    reentrantEngine = harness.engine;
    harness.engine.start({ phase: 'guided', strokeIndex: 0 });
    harness.calls.quiz[0].onMistake(validStrokeData({ isBackwards: true }));
    assert.equal(errorPath(harness.target), undefined);
    assert.equal(dot(harness.target).getAttribute('visibility'), 'hidden');
  });
  await t.test('complete observer destroys', () => {
    let reentrantEngine;
    const harness = createHarness({ options: { onEvent() { reentrantEngine.destroy(); } } });
    reentrantEngine = harness.engine;
    harness.engine.start({ phase: 'guided', strokeIndex: 0 });
    harness.calls.quiz[0].onComplete({ totalMistakes: 0 });
    assert.equal(harness.target.children.length, 0);
    assert.equal(harness.document.listeners.get('mouseup').length, 0);
    assert.equal(harness.calls.cancelQuiz, 1);
  });
});

test('showHint is a no-op during the final-correct callback window', () => {
  let reentrantEngine;
  const harness = createHarness({ options: { onEvent() { reentrantEngine.showHint(); } } });
  reentrantEngine = harness.engine;
  harness.engine.start({ phase: 'guided', strokeIndex: 1 });
  harness.calls.quiz[0].onCorrectStroke(validStrokeData({ strokeNum: 1, strokesRemaining: 0 }));
  assert.deepEqual(harness.calls.highlight, []);
  assert.equal(dot(harness.target).getAttribute('visibility'), 'hidden');
});

test('showHint settles writer promises and keeps the owned quiz active on fulfillment', async () => {
  let fulfillmentCalls = 0;
  const harness = createHarness({
    writer: {
      highlightStroke(strokeNum) {
        harness.calls.highlight.push(strokeNum);
        return {
          then(resolve) {
            fulfillmentCalls += 1;
            resolve();
          }
        };
      }
    }
  });
  harness.engine.start({ phase: 'guided', strokeIndex: 0 });
  assert.doesNotThrow(() => harness.engine.showHint());
  await flushMicrotasks();

  assert.deepEqual(harness.calls.highlight, [0]);
  assert.equal(fulfillmentCalls, 1);
  assert.doesNotThrow(() => harness.engine.restart());
});

test('owned hint failures deactivate the board and notify onError exactly once', async (t) => {
  const cases = [
    ['synchronous throw', (error) => { throw error; }],
    ['then getter throw', (error) => throwingThen(error)],
    ['promise rejection', (error) => Promise.reject(error)]
  ];

  for (const [name, fail] of cases) {
    await t.test(name, async () => {
      const failure = new Error(`hint ${name}`);
      const errors = [];
      const harness = createHarness({
        writer: { highlightStroke() { return fail(failure); } },
        options: { onError(error) { errors.push(error); } }
      });
      harness.engine.start({ phase: 'guided', strokeIndex: 0 });

      assert.doesNotThrow(() => harness.engine.showHint());
      await flushMicrotasks();

      assert.deepEqual(errors, [failure]);
      assert.equal(harness.target.getAttribute('aria-busy'), 'false');
      assert.equal(dot(harness.target).getAttribute('visibility'), 'hidden');
      assert.throws(() => harness.engine.restart(), /must be active/);
    });
  }
});

test('stale hint rejection cannot notify, cancel, or deactivate a replacement quiz', async () => {
  const firstHint = deferred();
  const errors = [];
  let highlightCalls = 0;
  const harness = createHarness({
    writer: {
      highlightStroke(strokeNum) {
        harness.calls.highlight.push(strokeNum);
        highlightCalls += 1;
        return highlightCalls === 1 ? firstHint.promise : Promise.resolve();
      }
    },
    options: { onError(error) { errors.push(error); } }
  });
  harness.engine.start({ phase: 'guided', strokeIndex: 0 });
  harness.engine.showHint();
  harness.engine.restart();
  const replacement = harness.calls.quiz.at(-1);
  const cancelCount = harness.calls.cancelQuiz;

  firstHint.reject(new Error('stale hint rejected'));
  await flushMicrotasks();

  assert.deepEqual(errors, []);
  assert.equal(harness.calls.cancelQuiz, cancelCount);
  assert.equal(harness.calls.installedQuiz, replacement);
  assert.doesNotThrow(() => harness.engine.showHint());
  assert.deepEqual(harness.calls.highlight, [0, 0]);
});

test('hint failure cleanup completes before reentrant onError replacement', async () => {
  const failure = new Error('hint failed');
  const errors = [];
  let engine;
  const harness = createHarness({
    writer: { highlightStroke() { return Promise.reject(failure); } },
    options: {
      onError(error) {
        errors.push(error);
        engine.start({ phase: 'independent', strokeIndex: 1 });
      }
    }
  });
  engine = harness.engine;
  engine.start({ phase: 'guided', strokeIndex: 0 });
  engine.showHint();
  await flushMicrotasks();

  assert.deepEqual(errors, [failure]);
  assert.equal(harness.calls.quiz.at(-1).quizStartStrokeNum, 1);
  assert.equal(harness.calls.installedQuiz, harness.calls.quiz.at(-1));
  assert.doesNotThrow(() => engine.restart());
});

test('replacement, hint, restart, and cancel preserve callback ownership and state', () => {
  const { calls, engine, events, target } = createHarness();
  engine.start({ phase: 'independent', strokeIndex: 1 });
  const old = calls.quiz[0];
  engine.start({ phase: 'guided', strokeIndex: 0 });
  old.onMistake({ strokeNum: 1, mistakesOnStroke: 1, totalMistakes: 1, strokesRemaining: 1,
    isBackwards: false, drawnPath: { pathString: 'M0 0', points: [] } });
  assert.deepEqual(events, []);
  assert.equal(errorPath(target), undefined);
  engine.showHint();
  assert.deepEqual(calls.highlight, [0]);
  calls.quiz[1].onCorrectStroke({ strokeNum: 0, mistakesOnStroke: 0, totalMistakes: 0, strokesRemaining: 1,
    isBackwards: false, drawnPath: { pathString: 'M0 0', points: [] } });
  engine.restart();
  assert.equal(calls.quiz.at(-1).quizStartStrokeNum, 0);
  assert.deepEqual(calls.outline.at(-1), ['show', { duration: 0 }]);
  const canceled = calls.quiz.at(-1);
  engine.cancel();
  engine.cancel();
  canceled.onComplete({ totalMistakes: 0 });
  assert.equal(calls.cancelQuiz, 3);
  assert.equal(events.length, 1);
  assert.equal(dot(target).getAttribute('visibility'), 'hidden');
});

test('resize updates the writer, overlay, and public transform without recreation', () => {
  const { calls, engine, target } = createHarness();
  engine.start({ phase: 'guided', strokeIndex: 1 });
  target.rect = { width: 640, height: 480 };
  engine.resize();
  assert.deepEqual(calls.dimensions, [{ width: 640, height: 480, padding: 0 }]);
  assert.equal(calls.create.length, 1);
  assert.deepEqual(calls.transforms.at(-1), [640, 480, 0]);
  const overlay = target.children.at(-1);
  assert.equal(overlay.getAttribute('width'), '640');
  assert.equal(overlay.getAttribute('height'), '480');
  assert.equal(overlay.getAttribute('viewBox'), '0 0 640 480');
  assert.equal(dot(target).parentNode.getAttribute('transform'), 'translate(640 480) scale(.25 -.25)');
});

test('second pointer suppresses input until every pointer ends, then restarts once', () => {
  const { calls, engine, events, target, timers } = createHarness();
  engine.start({ phase: 'independent', strokeIndex: 1 });
  target.dispatch('pointerdown', { pointerId: 4, isPrimary: true });
  target.dispatch('pointerdown', { pointerId: 9, isPrimary: false });
  assert.equal(calls.cancelQuiz, 1);
  assert.equal(calls.quiz.length, 1);

  calls.quiz[0].onMistake(validStrokeData({ strokeNum: 1 }));
  calls.quiz[0].onCorrectStroke(validStrokeData({ strokeNum: 1 }));
  target.dispatch('pointerup', { pointerId: 9 });
  assert.equal(calls.quiz.length, 1);
  target.dispatch('pointerup', { pointerId: 4 });
  assert.equal(calls.quiz.length, 1);
  assert.equal(target.getAttribute('aria-busy'), 'true');
  assert.equal(timers.pending.size, 1);
  timers.run([...timers.pending.keys()][0]);
  assert.equal(calls.quiz.length, 2);
  assert.equal(calls.quiz[1].quizStartStrokeNum, 1);
  assert.deepEqual(events, []);
});

test('suppressed input resumes once after duplicate cancel, lost-capture, and leave lifecycles', async (t) => {
  const cases = [
    ['pointercancel', 'pointercancel'],
    ['lostpointercapture', 'lostpointercapture'],
    ['pointerleave', 'pointerleave']
  ];
  for (const [name, terminalType] of cases) {
    await t.test(name, () => {
      const { calls, engine, events, target, timers } = createHarness();
      engine.start({ phase: 'independent', strokeIndex: 1 });
      target.dispatch('pointerdown', { pointerId: 4, isPrimary: true });
      target.dispatch(terminalType, { pointerId: 4, target });
      target.dispatch('lostpointercapture', { pointerId: 4, target });

      assert.equal(calls.cancelQuiz, 1);
      assert.equal(calls.quiz.length, 1);
      assert.equal(timers.pending.size, 1);
      timers.run([...timers.pending.keys()][0]);
      assert.equal(calls.quiz.length, 2);
      assert.equal(calls.quiz[1].quizStartStrokeNum, 1);
      assert.deepEqual(events, []);
    });
  }
});

test('pointer cancellation stays suppressed while its backing touch remains active', () => {
  const { calls, engine, target, timers } = createHarness();
  engine.start({ phase: 'independent', strokeIndex: 1 });
  target.dispatch('pointerdown', { pointerId: 4, isPrimary: true });
  target.dispatch('touchstart', { touches: [{ identifier: 4 }] });
  target.dispatch('pointercancel', { pointerId: 4 });

  timers.run([...timers.pending.keys()][0]);
  assert.equal(calls.quiz.length, 1);
  assert.equal(target.getAttribute('aria-busy'), 'true');

  target.dispatch('touchend', { touches: [] });
  assert.equal(timers.pending.size, 1);
  timers.run([...timers.pending.keys()][0]);
  assert.equal(calls.quiz.length, 2);
  assert.equal(calls.quiz[1].quizStartStrokeNum, 1);
});

test('restart updates a suppressed gesture without exposing a quiz, and destroy prevents resume', () => {
  const restarted = createHarness();
  restarted.engine.start({ phase: 'independent', strokeIndex: 1 });
  restarted.target.dispatch('pointerdown', { pointerId: 4, isPrimary: true });
  restarted.target.dispatch('pointerdown', { pointerId: 9, isPrimary: false });
  restarted.engine.restart();
  assert.equal(restarted.calls.quiz.length, 1);
  restarted.target.dispatch('pointerup', { pointerId: 9 });
  restarted.target.dispatch('pointerup', { pointerId: 4 });
  const restartTimer = [...restarted.timers.pending.keys()][0];
  restarted.timers.run(restartTimer);
  assert.equal(restarted.calls.quiz.length, 2);
  assert.equal(restarted.calls.quiz[1].quizStartStrokeNum, 0);

  const destroyed = createHarness();
  destroyed.engine.start({ phase: 'guided', strokeIndex: 1 });
  destroyed.target.dispatch('pointerdown', { pointerId: 4, isPrimary: true });
  destroyed.target.dispatch('pointercancel', { pointerId: 4 });
  const destroyedTimer = [...destroyed.timers.pending.keys()][0];
  destroyed.engine.destroy();
  destroyed.timers.runCleared(destroyedTimer);
  assert.equal(destroyed.calls.quiz.length, 1);
  assert.equal(destroyed.target.children.length, 0);
});

test('pointerleave only restarts when the active pointer leaves the board itself', () => {
  const { calls, engine, events, target } = createHarness();
  const writerSvg = target.queryByClass('practice-writer-host')[0].children[0];
  engine.start({ phase: 'independent', strokeIndex: 1 });
  target.dispatch('pointerdown', { pointerId: 4, isPrimary: true });

  target.dispatch('pointerleave', { pointerId: 4, target: writerSvg });
  assert.equal(calls.cancelQuiz, 0);

  target.dispatch('pointerleave', { pointerId: 4, target });
  assert.equal(calls.cancelQuiz, 1);
  assert.equal(calls.quiz.at(-1).quizStartStrokeNum, 1);
  assert.deepEqual(events, []);
});

test('mistake paths replace prior paths and honor normal and reduced-motion clearing', () => {
  const normal = createHarness();
  normal.engine.start({ phase: 'guided', strokeIndex: 0 });
  const callback = normal.calls.quiz[0].onMistake;
  const data = (path) => ({ strokeNum: 0, mistakesOnStroke: 1, totalMistakes: 1, strokesRemaining: 2,
    isBackwards: false, drawnPath: { pathString: path, points: [{ x: 1, y: 2 }] } });
  callback(data('M1 1'));
  const firstId = [...normal.timers.pending.keys()][0];
  assert.equal(normal.timers.pending.get(firstId).delay, 240);
  callback(data('M2 2'));
  assert.equal(normal.timers.pending.has(firstId), false);
  assert.equal(normal.target.queryByClass('practice-error-path').length, 1);
  normal.timers.runCleared(firstId);
  assert.equal(errorPath(normal.target).getAttribute('d'), 'M2 2');
  normal.timers.run([...normal.timers.pending.keys()][0]);
  assert.equal(errorPath(normal.target), undefined);

  const reduced = createHarness({ options: { reducedMotion: true } });
  reduced.engine.start({ phase: 'guided', strokeIndex: 0 });
  reduced.calls.quiz[0].onMistake(data('M3 3'));
  assert.equal(errorPath(reduced.target), undefined);
  assert.equal(reduced.timers.pending.size, 0);
});

test('destroy is idempotent and cleans quiz, timer, listeners, DOM, and target style', () => {
  const { calls, engine, target, timers } = createHarness();
  target.style.position = 'relative';
  engine.start({ phase: 'guided', strokeIndex: 0 });
  calls.quiz[0].onMistake({ strokeNum: 0, mistakesOnStroke: 1, totalMistakes: 1, strokesRemaining: 2,
    isBackwards: false, drawnPath: { pathString: 'M1 1', points: [] } });
  engine.destroy();
  engine.destroy();
  assert.equal(calls.cancelQuiz, 1);
  assert.equal(timers.pending.size, 0);
  assert.equal(target.children.length, 0);
  assert.equal(target.style.position, '');
  assert.equal([...target.listeners.values()].flat().length, 0);
  for (const command of [
    () => engine.start({ phase: 'guided', strokeIndex: 0 }), () => engine.restart(),
    () => engine.showHint(), () => engine.resize(), () => engine.cancel()
  ]) assert.throws(command, /destroyed/i);
});

test('writer construction failure rolls back overlay, listeners, and style', () => {
  const document = createDocument();
  const target = new FakeElement('div', document);
  target.style.position = 'static';
  const originalDocumentAdd = document.addEventListener;
  assert.throws(() => createPracticeEngine({
    target,
    HanziWriter: {
      create(host) {
        host.appendChild(new FakeElement('svg', document));
        document.addEventListener('mouseup', () => {});
        document.addEventListener('touchend', () => {});
        throw new Error('writer failed');
      },
      getScalingTransform() { return { transform: '' }; }
    },
    character: '潮',
    geometry: { strokeCount: 1, strokes: ['M0 0'], medians: [[[0, 0]]] },
    onEvent() {}
  }), /writer failed/);
  assert.equal(target.children.length, 0);
  assert.equal(target.style.position, 'static');
  assert.equal([...target.listeners.values()].flat().length, 0);
  assert.equal([...document.listeners.values()].flat().length, 0);
  assert.equal(document.addEventListener, originalDocumentAdd);

  const partialTarget = new FakeElement('div', document);
  const addListener = partialTarget.addEventListener;
  partialTarget.addEventListener = function (type, callback, listenerOptions) {
    addListener.call(this, type, callback, listenerOptions);
    if (type === 'pointerup') throw new Error('listener failed');
  };
  assert.throws(() => createPracticeEngine({
    target: partialTarget,
    HanziWriter: { create() { assert.fail('writer should not be created'); }, getScalingTransform() { return { transform: '' }; } },
    character: '潮',
    geometry: { strokeCount: 1, strokes: ['M0 0'], medians: [[[0, 0]]] },
    onEvent() {}
  }), /listener failed/);
  assert.equal([...partialTarget.listeners.values()].flat().length, 0);
  assert.equal(partialTarget.children.length, 0);
  assert.equal(partialTarget.style.position, '');
});

test('fails with full rollback when document listener capture cannot be installed safely', () => {
  const document = createDocument();
  const addEventListener = document.addEventListener;
  Object.defineProperty(document, 'addEventListener', {
    configurable: false,
    writable: false,
    value: addEventListener
  });
  const target = new FakeElement('div', document);
  assert.throws(() => createPracticeEngine({
    target,
    HanziWriter: {
      create() { assert.fail('writer must not be constructed without listener capture'); },
      getScalingTransform() { return { transform: '' }; }
    },
    character: '潮',
    geometry: { strokeCount: 1, strokes: ['M0 0'], medians: [[[0, 0]]] },
    onEvent() {}
  }), /document listener capture/i);
  assert.equal(target.children.length, 0);
  assert.equal(target.style.position, '');
  assert.equal(document.addEventListener, addEventListener);
});

test('position ownership follows computed style and preserves later external inline changes', () => {
  const positioned = createHarness({ computedPosition: 'absolute' });
  assert.equal(positioned.target.style.position, '');
  positioned.engine.destroy();
  assert.equal(positioned.target.style.position, '');

  const staticTarget = createHarness({ computedPosition: 'static' });
  assert.equal(staticTarget.target.style.position, 'relative');
  staticTarget.target.style.position = 'fixed';
  staticTarget.engine.destroy();
  assert.equal(staticTarget.target.style.position, 'fixed');
});

test('rejects invalid options and starts atomically without invoking accessors', () => {
  assert.throws(() => createPracticeEngine({}), /options\.target/);
  const harness = createHarness();
  assert.throws(() => harness.engine.start({ phase: 'guided', strokeIndex: 2 }), /strokeIndex/);
  assert.throws(() => harness.engine.start({ phase: 'guided', get strokeIndex() { assert.fail('accessor invoked'); } }), /own data property/);
  assert.equal(harness.calls.quiz.length, 0);
  assert.throws(() => createPracticeEngine({
    ...harness.options,
    get character() { assert.fail('accessor invoked'); }
  }), /own data property/);
  assert.throws(() => createPracticeEngine({
    ...harness.options,
    HanziWriter: {
      get create() { assert.fail('accessor invoked'); },
      getScalingTransform() { return { transform: '' }; }
    }
  }), /own data property/);
  assert.throws(() => createPracticeEngine({ ...harness.options, extra: true }), /not allowed/);
});

test('invalid correct-stroke callback fields are entirely inert', async (t) => {
  const base = validStrokeData();
  const cases = [
    ['missing strokeNum', withoutField(base, 'strokeNum')],
    ['mismatched strokeNum', { ...base, strokeNum: 1 }],
    ['invalid strokeNum', { ...base, strokeNum: -1 }],
    ['missing mistakesOnStroke', withoutField(base, 'mistakesOnStroke')],
    ['invalid mistakesOnStroke', { ...base, mistakesOnStroke: 0.5 }],
    ['missing totalMistakes', withoutField(base, 'totalMistakes')],
    ['invalid totalMistakes', { ...base, totalMistakes: -1 }],
    ['missing strokesRemaining', withoutField(base, 'strokesRemaining')],
    ['invalid strokesRemaining', { ...base, strokesRemaining: Number.MAX_SAFE_INTEGER + 1 }],
    ['missing drawnPath', withoutField(base, 'drawnPath')],
    ['invalid drawnPath', { ...base, drawnPath: null }],
    ['missing pathString', { ...base, drawnPath: withoutField(base.drawnPath, 'pathString') }],
    ['blank pathString', { ...base, drawnPath: { ...base.drawnPath, pathString: ' ' } }],
    ['missing points', { ...base, drawnPath: withoutField(base.drawnPath, 'points') }],
    ['invalid points', { ...base, drawnPath: { ...base.drawnPath, points: null } }],
    ['missing point x', { ...base, drawnPath: { ...base.drawnPath, points: [{ y: 2 }] } }],
    ['missing point y', { ...base, drawnPath: { ...base.drawnPath, points: [{ x: 1 }] } }],
    ['non-finite point', { ...base, drawnPath: { ...base.drawnPath, points: [{ x: Infinity, y: 2 }] } }]
  ];
  for (const field of ['strokeNum', 'mistakesOnStroke', 'totalMistakes', 'strokesRemaining', 'drawnPath']) {
    cases.push([`hostile ${field}`, withHostileField(base, field)]);
  }

  for (const [name, data] of cases) {
    await t.test(name, () => {
      const { calls, engine, events, target } = createHarness();
      engine.start({ phase: 'guided', strokeIndex: 0 });
      calls.quiz[0].onCorrectStroke(data);
      assert.deepEqual(events, []);
      assert.equal(dot(target).getAttribute('cx'), '10');
      assert.equal(dot(target).getAttribute('visibility'), 'visible');
      assert.equal(errorPath(target), undefined);
      engine.showHint();
      assert.deepEqual(calls.highlight, [0]);
    });
  }
});

test('invalid mistake callback fields are entirely inert', async (t) => {
  const base = validStrokeData({ isBackwards: true });
  const cases = [
    ['missing strokeNum', withoutField(base, 'strokeNum')],
    ['mismatched strokeNum', { ...base, strokeNum: 1 }],
    ['invalid strokeNum', { ...base, strokeNum: -1 }],
    ['missing mistakesOnStroke', withoutField(base, 'mistakesOnStroke')],
    ['invalid mistakesOnStroke', { ...base, mistakesOnStroke: -1 }],
    ['missing totalMistakes', withoutField(base, 'totalMistakes')],
    ['invalid totalMistakes', { ...base, totalMistakes: 1.25 }],
    ['missing strokesRemaining', withoutField(base, 'strokesRemaining')],
    ['invalid strokesRemaining', { ...base, strokesRemaining: '1' }],
    ['missing drawnPath', withoutField(base, 'drawnPath')],
    ['invalid drawnPath', { ...base, drawnPath: [] }],
    ['missing pathString', { ...base, drawnPath: withoutField(base.drawnPath, 'pathString') }],
    ['blank pathString', { ...base, drawnPath: { ...base.drawnPath, pathString: '' } }],
    ['missing points', { ...base, drawnPath: withoutField(base.drawnPath, 'points') }],
    ['invalid point', { ...base, drawnPath: { ...base.drawnPath, points: [{ x: 1, y: NaN }] } }],
    ['missing isBackwards', withoutField(base, 'isBackwards')],
    ['invalid isBackwards', { ...base, isBackwards: 1 }]
  ];
  for (const field of ['strokeNum', 'mistakesOnStroke', 'totalMistakes', 'strokesRemaining', 'drawnPath', 'isBackwards']) {
    cases.push([`hostile ${field}`, withHostileField(base, field)]);
  }

  for (const [name, data] of cases) {
    await t.test(name, () => {
      const { calls, engine, events, target, timers } = createHarness();
      engine.start({ phase: 'guided', strokeIndex: 0 });
      calls.quiz[0].onMistake(data);
      assert.deepEqual(events, []);
      assert.equal(dot(target).getAttribute('cx'), '10');
      assert.equal(dot(target).getAttribute('visibility'), 'visible');
      assert.equal(errorPath(target), undefined);
      assert.equal(timers.pending.size, 0);
      engine.showHint();
      assert.deepEqual(calls.highlight, [0]);
    });
  }
});

test('invalid complete callbacks remain active and supported data stays detached', async (t) => {
  const cases = [
    ['missing totalMistakes', {}],
    ['negative totalMistakes', { totalMistakes: -1 }],
    ['fractional totalMistakes', { totalMistakes: 1.5 }],
    ['unsafe totalMistakes', { totalMistakes: Number.MAX_SAFE_INTEGER + 1 }],
    ['hostile totalMistakes', withHostileField({}, 'totalMistakes')]
  ];
  for (const [name, data] of cases) {
    await t.test(name, () => {
      const { calls, engine, events, target } = createHarness();
      engine.start({ phase: 'guided', strokeIndex: 0 });
      calls.quiz[0].onComplete(data);
      assert.deepEqual(events, []);
      assert.equal(dot(target).getAttribute('visibility'), 'visible');
      engine.showHint();
      assert.deepEqual(calls.highlight, [0]);
    });
  }

  const { calls, engine, events } = createHarness();
  engine.start({ phase: 'guided', strokeIndex: 0 });
  const data = { totalMistakes: 2 };
  Object.defineProperty(data, 'character', {
    get() { assert.fail('unsupported character getter invoked'); }
  });
  calls.quiz[0].onComplete(data);
  assert.deepEqual(events, [{ type: 'character-complete', totalMistakes: 2 }]);
  assert.equal(Object.isFrozen(events[0]), true);
});

test('public API is frozen and exact, and UMD merge has no DOM or fetch load-time dependency', async () => {
  const { engine } = createHarness();
  assert.equal(Object.isFrozen(engine), true);
  assert.deepEqual(Object.keys(engine), ['start', 'restart', 'showHint', 'resize', 'cancel', 'destroy']);
  const source = await readFile(new URL('../js/practice-engine.js', import.meta.url), 'utf8');
  const sentinel = { retained: true };
  const context = { window: { HanziApp: sentinel } };
  vm.runInNewContext(source, context);
  assert.equal(context.window.HanziApp.retained, true);
  assert.equal(typeof context.window.HanziApp.createPracticeEngine, 'function');
});
