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
  return { createElementNS(_namespace, name) { return new FakeElement(name, this); } };
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
  const events = [];
  const calls = { create: [], quiz: [], cancelQuiz: 0, outline: [], highlight: [], dimensions: [], transforms: [] };
  const writer = {
    quiz(options) { calls.quiz.push(options); },
    cancelQuiz() { calls.cancelQuiz += 1; },
    highlightStroke(strokeNum) { calls.highlight.push(strokeNum); },
    updateDimensions(options) { calls.dimensions.push(options); },
    showOutline(options) { calls.outline.push(['show', options]); },
    hideOutline(options) { calls.outline.push(['hide', options]); }
  };
  const HanziWriter = {
    create(...args) { calls.create.push(args); if (overrides.createError) throw overrides.createError; return writer; },
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
  const engine = createPracticeEngine(options);
  return { calls, document, engine, events, geometry, HanziWriter, options, target, timers, writer };
}

function dot(target) { return target.queryByClass('practice-start-dot')[0]; }
function errorPath(target) { return target.queryByClass('practice-error-path')[0]; }

test('creates one writer with exact local data and a separate pointer-transparent overlay', () => {
  const { calls, geometry, target } = createHarness();
  assert.equal(calls.create.length, 1);
  const [writerTarget, character, options] = calls.create[0];
  assert.equal(writerTarget, target);
  assert.equal(character, '潮');
  assert.deepEqual({ ...options, charDataLoader: undefined }, {
    width: 320, height: 280, padding: 24,
    showCharacter: false, showOutline: true,
    drawingColor: '#1769aa', strokeColor: '#20252b', highlightColor: '#d92d20',
    acceptBackwardsStrokes: false, leniency: 1, highlightOnComplete: false,
    charDataLoader: undefined
  });
  let loaded;
  options.charDataLoader('潮', (data) => { loaded = data; }, () => assert.fail('local loader failed'));
  assert.deepEqual(loaded, { strokes: geometry.strokes, medians: geometry.medians });
  assert.notEqual(loaded.strokes, geometry.strokes);
  assert.notEqual(loaded.medians, geometry.medians);
  assert.equal(Object.isFrozen(loaded), true);
  const overlay = target.children.at(-1);
  assert.equal(overlay.name, 'svg');
  assert.equal(overlay.style.pointerEvents, 'none');
  assert.equal(overlay.style.position, 'absolute');
  assert.equal(target.style.position, 'relative');
  assert.equal(dot(target).getAttribute('visibility'), 'hidden');
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
  assert.deepEqual(calls.dimensions, [{ width: 640, height: 480, padding: 24 }]);
  assert.equal(calls.create.length, 1);
  assert.deepEqual(calls.transforms.at(-1), [640, 480, 24]);
  const overlay = target.children.at(-1);
  assert.equal(overlay.getAttribute('width'), '640');
  assert.equal(overlay.getAttribute('height'), '480');
  assert.equal(overlay.getAttribute('viewBox'), '0 0 640 480');
  assert.equal(dot(target).parentNode.getAttribute('transform'), 'translate(640 480) scale(.25 -.25)');
});

test('second pointer and abnormal primary termination restart the same stroke without events', () => {
  const { calls, engine, events, target } = createHarness();
  engine.start({ phase: 'independent', strokeIndex: 1 });
  target.dispatch('pointerdown', { pointerId: 4, isPrimary: true });
  target.dispatch('pointerdown', { pointerId: 9, isPrimary: false });
  assert.equal(calls.quiz.at(-1).quizStartStrokeNum, 1);
  assert.equal(calls.cancelQuiz, 1);
  target.dispatch('pointerdown', { pointerId: 7, isPrimary: true });
  target.dispatch('pointercancel', { pointerId: 7 });
  assert.equal(calls.quiz.at(-1).quizStartStrokeNum, 1);
  assert.equal(calls.cancelQuiz, 2);
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
  assert.throws(() => createPracticeEngine({
    target,
    HanziWriter: { create() { throw new Error('writer failed'); }, getScalingTransform() { return { transform: '' }; } },
    character: '潮',
    geometry: { strokeCount: 1, strokes: ['M0 0'], medians: [[[0, 0]]] },
    onEvent() {}
  }), /writer failed/);
  assert.equal(target.children.length, 0);
  assert.equal(target.style.position, 'static');
  assert.equal([...target.listeners.values()].flat().length, 0);

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

test('invalid callback data is ignored without corrupting current stroke', () => {
  const { calls, engine, events } = createHarness();
  engine.start({ phase: 'guided', strokeIndex: 0 });
  calls.quiz[0].onCorrectStroke({ strokeNum: -1 });
  calls.quiz[0].onMistake({ get strokeNum() { assert.fail('accessor invoked'); } });
  assert.deepEqual(events, []);
  engine.showHint();
  assert.deepEqual(calls.highlight, [0]);
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
