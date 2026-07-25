import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import animationControllerModule from '../js/animation-controller.js';

const { createAnimationController } = animationControllerModule;

const TIMING = Object.freeze({
  minimumStroke: 300,
  maximumStroke: 1200,
  millisecondsPerLengthUnit: 2,
  betweenStrokes: 180,
  completedCharacter: 900
});

function strokeDuration(length, speed = 'normal') {
  const multiplier = { slow: 1.45, normal: 1, fast: 0.7 }[speed];
  const base = Math.min(
    TIMING.maximumStroke,
    Math.max(TIMING.minimumStroke, length * TIMING.millisecondsPerLengthUnit)
  );
  return base * multiplier;
}

function createFakeClock(start = 0, firstFrameId = 1) {
  let currentTime = start;
  let nextFrameId = firstFrameId;
  const callbacks = new Map();
  const cancellations = [];
  let requestCount = 0;

  return {
    now: () => currentTime,
    requestFrame: (callback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      requestCount += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      cancellations.push(id);
      callbacks.delete(id);
    },
    tick: (milliseconds) => {
      assert.ok(Number.isFinite(milliseconds) && milliseconds >= 0);
      currentTime += milliseconds;
      const batch = Array.from(callbacks.entries());
      callbacks.clear();
      batch.forEach(([, callback]) => callback(currentTime));
    },
    elapse: (milliseconds) => {
      assert.ok(Number.isFinite(milliseconds) && milliseconds >= 0);
      currentTime += milliseconds;
    },
    getPending: () => new Map(callbacks),
    getCancellations: () => cancellations.slice(),
    getRequestCount: () => requestCount
  };
}

function createFakeRenderer(lengths = [250, 200]) {
  const calls = [];
  const renderer = {
    getStrokeCount() {
      calls.push(['getStrokeCount']);
      return lengths.length;
    },
    getStrokeLength(index) {
      calls.push(['getStrokeLength', index]);
      return lengths[index];
    },
    setStrokeProgress(index, progress) {
      calls.push(['setStrokeProgress', index, progress]);
    },
    showCompletedThrough(index) {
      calls.push(['showCompletedThrough', index]);
    },
    showFullCharacter() {
      calls.push(['showFullCharacter']);
    }
  };
  return { renderer, calls };
}

function createHarness(lengths, overrides = {}) {
  const clock = createFakeClock();
  const { renderer, calls } = createFakeRenderer(lengths);
  const stateChanges = [];
  const options = {
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    onStateChange: (state) => stateChanges.push(state),
    ...overrides
  };
  const controller = createAnimationController(renderer, options);
  return { calls, clock, controller, options, renderer, stateChanges };
}

function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

function lastProgressCall(calls) {
  return calls.filter(([name]) => name === 'setStrokeProgress').at(-1);
}

test('starts idle on the first stroke at zero progress and renders that position', () => {
  const { calls, controller } = createHarness([250, 200]);

  assert.deepEqual(controller.getState(), {
    status: 'idle',
    mode: 'continuous',
    strokeIndex: 0,
    progress: 0,
    speed: 'normal'
  });
  assert.deepEqual(lastProgressCall(calls), ['setStrokeProgress', 0, 0]);
  assert.ok(Object.isFrozen(controller));
});

test('pauses and resumes at the same relative stroke progress', () => {
  const { calls, clock, controller } = createHarness([250]);

  controller.play();
  clock.tick(200);
  closeTo(controller.getState().progress, 0.4);
  controller.pause();
  const paused = controller.getState();
  assert.equal(paused.status, 'paused');
  assert.equal(clock.getPending().size, 0);

  clock.elapse(5000);
  controller.play();
  clock.tick(100);

  assert.equal(controller.getState().status, 'playing');
  closeTo(controller.getState().progress, 0.6);
  closeTo(lastProgressCall(calls)[2], 0.6);
});

test('pause and play preserve only the remaining between-stroke delay', () => {
  const { clock, controller } = createHarness([150, 200]);
  controller.play();
  clock.tick(strokeDuration(150));
  clock.tick(50);
  clock.elapse(50);

  controller.pause();
  assert.equal(controller.getState().status, 'paused');
  clock.elapse(5000);
  controller.play();
  assert.equal(controller.getState().status, 'between-strokes');
  clock.tick(79);
  assert.equal(controller.getState().status, 'between-strokes');
  clock.tick(1);
  assert.equal(controller.getState().status, 'playing');
  assert.equal(controller.getState().strokeIndex, 1);
});

test('pause and play preserve only the remaining completed-character hold', () => {
  const { clock, controller } = createHarness([150]);
  controller.play();
  clock.tick(strokeDuration(150));
  clock.tick(100);
  clock.elapse(100);

  controller.pause();
  assert.equal(controller.getState().status, 'paused');
  clock.elapse(5000);
  controller.play();
  assert.equal(controller.getState().status, 'completed');
  clock.tick(699);
  assert.equal(controller.getState().status, 'completed');
  clock.tick(1);
  assert.equal(controller.getState().status, 'playing');
  assert.equal(controller.getState().strokeIndex, 0);
});

test('renders bounded progress and moves through stroke, gap, completed hold, and loop', () => {
  const { calls, clock, controller } = createHarness([150, 200]);

  controller.play();
  clock.tick(strokeDuration(150));
  assert.deepEqual(controller.getState(), {
    status: 'between-strokes',
    mode: 'continuous',
    strokeIndex: 0,
    progress: 1,
    speed: 'normal'
  });
  assert.deepEqual(calls.filter(([name]) => name === 'showCompletedThrough').at(-1), [
    'showCompletedThrough', 0
  ]);

  clock.tick(TIMING.betweenStrokes - 1);
  assert.equal(controller.getState().status, 'between-strokes');
  clock.tick(1);
  assert.deepEqual(controller.getState(), {
    status: 'playing',
    mode: 'continuous',
    strokeIndex: 1,
    progress: 0,
    speed: 'normal'
  });

  clock.tick(strokeDuration(200));
  assert.equal(controller.getState().status, 'completed');
  assert.equal(controller.getState().strokeIndex, 1);
  assert.equal(controller.getState().progress, 1);
  assert.deepEqual(calls.filter(([name]) => name === 'showFullCharacter').at(-1), [
    'showFullCharacter'
  ]);

  clock.tick(TIMING.completedCharacter - 1);
  assert.equal(controller.getState().status, 'completed');
  clock.tick(1);
  assert.deepEqual(controller.getState(), {
    status: 'playing',
    mode: 'continuous',
    strokeIndex: 0,
    progress: 0,
    speed: 'normal'
  });

  calls.filter(([name]) => name === 'setStrokeProgress').forEach(([, , progress]) => {
    assert.ok(progress >= 0 && progress <= 1, `renderer received invalid progress ${progress}`);
  });
});

test('carries a late frame across multiple phases without losing elapsed time', () => {
  const { clock, controller } = createHarness([150, 200]);

  controller.play();
  clock.tick(strokeDuration(150) + TIMING.betweenStrokes + 100);

  assert.equal(controller.getState().status, 'playing');
  assert.equal(controller.getState().strokeIndex, 1);
  closeTo(controller.getState().progress, 0.25);
});

test('fast-forwards huge continuous overshoot with bounded observable work', async (t) => {
  await t.test('twenty hours on one zero-length stroke', () => {
    const { calls, clock, controller, stateChanges } = createHarness([0]);
    controller.play();

    clock.tick((20 * 60 * 60 * 1000) + 150);

    assert.equal(controller.getState().status, 'playing');
    assert.equal(controller.getState().strokeIndex, 0);
    closeTo(controller.getState().progress, 0.5);
    assert.ok(calls.length < 10, `renderer received ${calls.length} calls`);
    assert.ok(stateChanges.length < 10, `observer received ${stateChanges.length} calls`);
  });

  await t.test('different stroke lengths, gaps, hold, and slow speed', () => {
    const { calls, clock, controller, stateChanges } = createHarness([150, 250]);
    const completeCycle = (
      strokeDuration(150, 'slow')
      + (TIMING.betweenStrokes * 1.45)
      + strokeDuration(250, 'slow')
      + (TIMING.completedCharacter * 1.45)
    );
    controller.setSpeed('slow');
    controller.play();

    clock.tick(
      (completeCycle * 50_000)
      + strokeDuration(150, 'slow')
      + (TIMING.betweenStrokes * 1.45)
      + 145
    );

    assert.equal(controller.getState().status, 'playing');
    assert.equal(controller.getState().strokeIndex, 1);
    closeTo(controller.getState().progress, 0.2);
    assert.ok(calls.length < 20, `renderer received ${calls.length} calls`);
    assert.ok(stateChanges.length < 10, `observer received ${stateChanges.length} calls`);
  });
});

test('exact full-cycle fast-forward preserves arbitrary phase positions', async (t) => {
  const twoStrokeCycle = (
    strokeDuration(150)
    + TIMING.betweenStrokes
    + strokeDuration(200)
    + TIMING.completedCharacter
  );

  await t.test('halfway through a stroke', () => {
    const { calls, clock, controller, stateChanges } = createHarness([150, 200]);
    controller.play();
    clock.tick(150);
    const callCount = calls.length;
    const changeCount = stateChanges.length;

    clock.tick(twoStrokeCycle * 50_000);

    assert.equal(controller.getState().status, 'playing');
    assert.equal(controller.getState().strokeIndex, 0);
    closeTo(controller.getState().progress, 0.5);
    assert.equal(calls.length, callCount);
    assert.equal(stateChanges.length, changeCount);
  });

  await t.test('halfway through a between-stroke delay', () => {
    const { calls, clock, controller, stateChanges } = createHarness([150, 200]);
    controller.play();
    clock.tick(strokeDuration(150));
    clock.tick(TIMING.betweenStrokes / 2);
    const callCount = calls.length;
    const changeCount = stateChanges.length;

    clock.tick(twoStrokeCycle * 50_000);

    assert.equal(controller.getState().status, 'between-strokes');
    assert.equal(controller.getState().strokeIndex, 0);
    assert.equal(controller.getState().progress, 1);
    assert.equal(calls.length, callCount);
    assert.equal(stateChanges.length, changeCount);
  });

  await t.test('halfway through a completed-character hold', () => {
    const { calls, clock, controller, stateChanges } = createHarness([150]);
    const oneStrokeCycle = strokeDuration(150) + TIMING.completedCharacter;
    controller.play();
    clock.tick(strokeDuration(150));
    clock.tick(TIMING.completedCharacter / 2);
    const callCount = calls.length;
    const changeCount = stateChanges.length;

    clock.tick(oneStrokeCycle * 50_000);

    assert.equal(controller.getState().status, 'completed');
    assert.equal(controller.getState().strokeIndex, 0);
    assert.equal(controller.getState().progress, 1);
    assert.equal(calls.length, callCount);
    assert.equal(stateChanges.length, changeCount);
  });
});

test('normalizes floating modulo error for huge exact non-integer cycles', () => {
  const length = 234.567;
  const completeCycle = strokeDuration(length) + TIMING.completedCharacter;
  const { calls, clock, controller, stateChanges } = createHarness([length]);
  controller.play();
  clock.tick(strokeDuration(length) / 2);
  const stateBeforeCycles = controller.getState();
  const callCount = calls.length;
  const changeCount = stateChanges.length;

  clock.tick(completeCycle * 50_000);

  assert.deepEqual(controller.getState(), stateBeforeCycles);
  assert.equal(calls.length, callCount);
  assert.equal(stateChanges.length, changeCount);
});

test('huge overshoot in step mode completes once with bounded work', () => {
  const { calls, clock, controller, stateChanges } = createHarness([150, 200]);
  controller.nextStroke();

  clock.tick(20 * 60 * 60 * 1000);

  assert.equal(controller.getState().status, 'paused');
  assert.equal(controller.getState().mode, 'step');
  assert.equal(controller.getState().strokeIndex, 1);
  assert.equal(controller.getState().progress, 1);
  assert.ok(calls.length < 10, `renderer received ${calls.length} calls`);
  assert.ok(stateChanges.length < 10, `observer received ${stateChanges.length} calls`);
});

test('a replay command from onStateChange supersedes the old frame remainder', () => {
  const clock = createFakeClock();
  const { calls, renderer } = createFakeRenderer([150, 150]);
  let controller;
  let replayed = false;
  controller = createAnimationController(renderer, {
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    onStateChange(state) {
      if (!replayed && state.status === 'between-strokes') {
        replayed = true;
        controller.replay();
      }
    }
  });
  controller.play();

  clock.tick(400);

  assert.equal(replayed, true);
  assert.deepEqual(controller.getState(), {
    status: 'playing',
    mode: 'continuous',
    strokeIndex: 0,
    progress: 0,
    speed: 'normal'
  });
  assert.deepEqual(lastProgressCall(calls), ['setStrokeProgress', 0, 0]);
  assert.equal(clock.getPending().size, 1);
});

test('a step command from onStateChange supersedes the old frame remainder', () => {
  const clock = createFakeClock();
  const { calls, renderer } = createFakeRenderer([150, 150]);
  let controller;
  let stepped = false;
  controller = createAnimationController(renderer, {
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    onStateChange(state) {
      if (!stepped && state.status === 'between-strokes') {
        stepped = true;
        controller.nextStroke();
      }
    }
  });
  controller.play();

  clock.tick(400);

  assert.equal(stepped, true);
  assert.deepEqual(controller.getState(), {
    status: 'playing',
    mode: 'step',
    strokeIndex: 1,
    progress: 0,
    speed: 'normal'
  });
  assert.deepEqual(lastProgressCall(calls), ['setStrokeProgress', 1, 0]);
  assert.equal(clock.getPending().size, 1);
});

test('destroy from onStateChange stops the old frame and all later rendering', () => {
  const clock = createFakeClock();
  const { calls, renderer } = createFakeRenderer([150, 150]);
  let controller;
  let destroyedAtCallCount = null;
  controller = createAnimationController(renderer, {
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    onStateChange(state) {
      if (destroyedAtCallCount === null && state.status === 'between-strokes') {
        controller.destroy();
        destroyedAtCallCount = calls.length;
      }
    }
  });
  controller.play();

  clock.tick(400);
  clock.tick(10_000);

  assert.notEqual(destroyedAtCallCount, null);
  assert.equal(calls.length, destroyedAtCallCount);
  assert.equal(clock.getPending().size, 0);
  assert.throws(() => controller.getState(), /destroyed/);
});

test('setSpeed from a settling pause supersedes the outer pause command', () => {
  const clock = createFakeClock();
  const { renderer } = createFakeRenderer([150, 150]);
  let controller;
  let changedSpeed = false;
  controller = createAnimationController(renderer, {
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    onStateChange(state) {
      if (!changedSpeed && state.status === 'between-strokes') {
        changedSpeed = true;
        controller.setSpeed('fast');
      }
    }
  });
  controller.play();
  clock.elapse(400);

  controller.pause();

  assert.equal(changedSpeed, true);
  assert.equal(controller.getState().status, 'between-strokes');
  assert.equal(controller.getState().speed, 'fast');
  assert.equal(clock.getPending().size, 1);
});

test('pause from a settling speed change supersedes the outer speed command', () => {
  const clock = createFakeClock();
  const { renderer } = createFakeRenderer([150, 150]);
  let controller;
  let paused = false;
  controller = createAnimationController(renderer, {
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    onStateChange(state) {
      if (!paused && state.status === 'between-strokes') {
        paused = true;
        controller.pause();
      }
    }
  });
  controller.play();
  clock.elapse(400);

  controller.setSpeed('slow');

  assert.equal(paused, true);
  assert.equal(controller.getState().status, 'paused');
  assert.equal(controller.getState().speed, 'normal');
  assert.equal(clock.getPending().size, 0);
});

test('physical hide remains applied when its settling callback replays', () => {
  const clock = createFakeClock();
  const { renderer } = createFakeRenderer([150, 150]);
  let controller;
  let replayed = false;
  controller = createAnimationController(renderer, {
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    onStateChange(state) {
      if (!replayed && state.status === 'between-strokes') {
        replayed = true;
        controller.replay();
      }
    }
  });
  controller.play();
  clock.elapse(400);

  controller.handleVisibilityChange(true);

  assert.equal(replayed, true);
  assert.equal(controller.getState().status, 'playing');
  assert.equal(controller.getState().strokeIndex, 0);
  assert.equal(controller.getState().progress, 0);
  assert.equal(clock.getPending().size, 0);
  clock.elapse(5000);
  assert.equal(controller.handleVisibilityChange(false), true);
  assert.equal(clock.getPending().size, 1);
  clock.tick(100);
  closeTo(controller.getState().progress, 1 / 3);
});

test('next and previous play only the target stroke in step mode', () => {
  const { calls, clock, controller } = createHarness([150, 200, 250]);

  assert.equal(controller.nextStroke(), true);
  assert.deepEqual(controller.getState(), {
    status: 'playing',
    mode: 'step',
    strokeIndex: 1,
    progress: 0,
    speed: 'normal'
  });
  clock.tick(strokeDuration(200));
  assert.deepEqual(controller.getState(), {
    status: 'paused',
    mode: 'step',
    strokeIndex: 1,
    progress: 1,
    speed: 'normal'
  });
  assert.deepEqual(calls.filter(([name]) => name === 'showCompletedThrough').at(-1), [
    'showCompletedThrough', 1
  ]);
  assert.equal(clock.getPending().size, 0);

  assert.equal(controller.previousStroke(), true);
  assert.equal(controller.getState().strokeIndex, 0);
  assert.equal(controller.getState().mode, 'step');
  assert.equal(controller.getState().progress, 0);
  clock.tick(strokeDuration(150));
  assert.equal(controller.getState().status, 'paused');
  assert.equal(controller.getState().strokeIndex, 0);
});

test('play resumes a partially paused step without changing to continuous mode', () => {
  const { clock, controller } = createHarness([150, 200]);
  controller.nextStroke();
  clock.tick(100);
  controller.pause();
  const pausedProgress = controller.getState().progress;

  controller.play();
  assert.equal(controller.getState().mode, 'step');
  clock.tick(strokeDuration(200) * (1 - pausedProgress));

  assert.equal(controller.getState().status, 'paused');
  assert.equal(controller.getState().mode, 'step');
  assert.equal(controller.getState().strokeIndex, 1);
  assert.equal(controller.getState().progress, 1);
});

test('play replays a naturally completed step from zero while keeping step mode', () => {
  const { calls, clock, controller } = createHarness([150, 200]);
  controller.nextStroke();
  clock.tick(strokeDuration(200));
  assert.equal(controller.getState().status, 'paused');
  assert.equal(controller.getState().progress, 1);

  controller.play();
  assert.deepEqual(controller.getState(), {
    status: 'playing',
    mode: 'step',
    strokeIndex: 1,
    progress: 0,
    speed: 'normal'
  });
  assert.deepEqual(lastProgressCall(calls), ['setStrokeProgress', 1, 0]);
  clock.tick(strokeDuration(200));
  assert.equal(controller.getState().status, 'paused');
  assert.equal(controller.getState().progress, 1);
});

test('step boundaries are clean no-ops that do not replace a pending frame', () => {
  const { calls, clock, controller } = createHarness([150, 200]);
  const initialState = controller.getState();
  const initialCallCount = calls.length;

  assert.equal(controller.previousStroke(), false);
  assert.deepEqual(controller.getState(), initialState);
  assert.equal(calls.length, initialCallCount);
  assert.equal(clock.getRequestCount(), 0);

  assert.equal(controller.nextStroke(), true);
  const pendingBeforeBoundary = Array.from(clock.getPending().keys());
  const requestsBeforeBoundary = clock.getRequestCount();
  const callsBeforeBoundary = calls.length;
  const stateBeforeBoundary = controller.getState();

  assert.equal(controller.nextStroke(), false);
  assert.deepEqual(controller.getState(), stateBeforeBoundary);
  assert.deepEqual(Array.from(clock.getPending().keys()), pendingBeforeBoundary);
  assert.equal(clock.getRequestCount(), requestsBeforeBoundary);
  assert.equal(calls.length, callsBeforeBoundary);
});

test('replay immediately resets to stroke one and starts continuous playback', () => {
  const { calls, clock, controller } = createHarness([250, 200]);
  controller.nextStroke();
  clock.tick(100);

  controller.replay();

  assert.deepEqual(controller.getState(), {
    status: 'playing',
    mode: 'continuous',
    strokeIndex: 0,
    progress: 0,
    speed: 'normal'
  });
  assert.deepEqual(lastProgressCall(calls), ['setStrokeProgress', 0, 0]);
  assert.equal(clock.getPending().size, 1);
});

test('applies exact slow, normal, and fast duration multipliers plus base clamps', async (t) => {
  const cases = [
    { name: 'slow', length: 250, speed: 'slow', elapsed: 362.5 },
    { name: 'normal', length: 250, speed: 'normal', elapsed: 250 },
    { name: 'fast', length: 250, speed: 'fast', elapsed: 175 },
    { name: 'minimum clamp', length: 1, speed: 'normal', elapsed: 150 },
    { name: 'maximum clamp', length: 10000, speed: 'normal', elapsed: 600 }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const { clock, controller } = createHarness([scenario.length]);
      controller.setSpeed(scenario.speed);
      controller.play();
      clock.tick(scenario.elapsed);
      closeTo(controller.getState().progress, 0.5);
      assert.equal(controller.getState().speed, scenario.speed);
    });
  }
});

test('settles elapsed time under the old speed before changing speed in place', () => {
  const { calls, clock, controller } = createHarness([250]);
  controller.play();
  clock.tick(100);
  closeTo(controller.getState().progress, 0.2);

  clock.elapse(100);
  controller.setSpeed('slow');
  closeTo(controller.getState().progress, 0.4);
  assert.equal(controller.getState().speed, 'slow');
  closeTo(lastProgressCall(calls)[2], 0.4);

  clock.tick(145);
  closeTo(controller.getState().progress, 0.6);
});

test('applies the selected speed multiplier to between and completed delays', async (t) => {
  await t.test('slow between-stroke delay', () => {
    const { clock, controller } = createHarness([150, 200]);
    controller.setSpeed('slow');
    controller.play();
    clock.tick(strokeDuration(150, 'slow'));
    clock.tick((TIMING.betweenStrokes * 1.45) - 1);
    assert.equal(controller.getState().status, 'between-strokes');
    clock.tick(1);
    assert.equal(controller.getState().status, 'playing');
    assert.equal(controller.getState().strokeIndex, 1);
  });

  await t.test('fast completed-character delay', () => {
    const { clock, controller } = createHarness([150]);
    controller.setSpeed('fast');
    controller.play();
    clock.tick(strokeDuration(150, 'fast'));
    clock.tick((TIMING.completedCharacter * 0.7) - 1);
    assert.equal(controller.getState().status, 'completed');
    clock.tick(1);
    assert.equal(controller.getState().status, 'playing');
    assert.equal(controller.getState().progress, 0);
  });
});

test('speed changes preserve relative completion of delay phases', async (t) => {
  await t.test('between-stroke phase', () => {
    const { clock, controller } = createHarness([150, 200]);
    controller.play();
    clock.tick(strokeDuration(150));
    clock.tick(50);
    clock.elapse(40);
    controller.setSpeed('slow');

    clock.tick((TIMING.betweenStrokes * 1.45 * 0.5) - 1);
    assert.equal(controller.getState().status, 'between-strokes');
    clock.tick(1);
    assert.equal(controller.getState().status, 'playing');
    assert.equal(controller.getState().strokeIndex, 1);
  });

  await t.test('completed-character phase', () => {
    const { clock, controller } = createHarness([150]);
    controller.play();
    clock.tick(strokeDuration(150));
    clock.tick(250);
    clock.elapse(200);
    controller.setSpeed('fast');

    clock.tick((TIMING.completedCharacter * 0.7 * 0.5) - 1);
    assert.equal(controller.getState().status, 'completed');
    clock.tick(1);
    assert.equal(controller.getState().status, 'playing');
    assert.equal(controller.getState().progress, 0);
  });
});

test('visibility freezes active stroke timing while preserving playback intent', () => {
  const { clock, controller } = createHarness([250]);
  controller.play();
  clock.tick(100);
  closeTo(controller.getState().progress, 0.2);

  controller.handleVisibilityChange(true);
  assert.equal(controller.getState().status, 'playing');
  assert.equal(clock.getPending().size, 0);
  clock.elapse(5000);
  controller.handleVisibilityChange(false);
  assert.equal(controller.getState().status, 'playing');
  assert.equal(clock.getPending().size, 1);
  clock.tick(100);
  closeTo(controller.getState().progress, 0.4);
});

test('visibility freezes and resumes the remaining between-stroke pause', () => {
  const { clock, controller } = createHarness([150, 200]);
  controller.play();
  clock.tick(strokeDuration(150));
  clock.tick(50);
  assert.equal(controller.getState().status, 'between-strokes');

  controller.handleVisibilityChange(true);
  clock.elapse(5000);
  controller.handleVisibilityChange(false);
  clock.tick(129);
  assert.equal(controller.getState().status, 'between-strokes');
  clock.tick(1);
  assert.equal(controller.getState().status, 'playing');
  assert.equal(controller.getState().strokeIndex, 1);
});

test('visibility freezes and resumes the remaining completed-character hold', () => {
  const { clock, controller } = createHarness([150]);
  controller.play();
  clock.tick(strokeDuration(150));
  clock.tick(100);
  assert.equal(controller.getState().status, 'completed');

  controller.handleVisibilityChange(true);
  clock.elapse(5000);
  controller.handleVisibilityChange(false);
  clock.tick(799);
  assert.equal(controller.getState().status, 'completed');
  clock.tick(1);
  assert.equal(controller.getState().status, 'playing');
  assert.equal(controller.getState().strokeIndex, 0);
  assert.equal(controller.getState().progress, 0);
});

test('manual pause does not auto-start after a hidden-visible cycle', () => {
  const { clock, controller } = createHarness([250]);
  controller.play();
  clock.tick(100);
  controller.pause();

  controller.handleVisibilityChange(true);
  clock.elapse(5000);
  controller.handleVisibilityChange(false);

  assert.equal(controller.getState().status, 'paused');
  closeTo(controller.getState().progress, 0.2);
  assert.equal(clock.getPending().size, 0);
});

test('pausing while hidden clears playback intent so visibility cannot restart it', () => {
  const { clock, controller } = createHarness([250]);
  controller.play();
  clock.tick(100);
  controller.handleVisibilityChange(true);

  controller.pause();
  assert.equal(controller.getState().status, 'paused');
  clock.elapse(5000);
  controller.handleVisibilityChange(false);

  assert.equal(controller.getState().status, 'paused');
  closeTo(controller.getState().progress, 0.2);
  assert.equal(clock.getPending().size, 0);
});

test('cancels a valid requestAnimationFrame handle of zero', () => {
  const clock = createFakeClock(0, 0);
  const { renderer } = createFakeRenderer([250]);
  const controller = createAnimationController(renderer, {
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame
  });

  controller.play();
  assert.deepEqual(Array.from(clock.getPending().keys()), [0]);
  controller.pause();

  assert.deepEqual(clock.getCancellations(), [0]);
  assert.equal(clock.getPending().size, 0);
});

test('publishes only distinct frozen user-visible snapshots', () => {
  const { clock, controller, stateChanges } = createHarness([250]);
  assert.equal(stateChanges.length, 0);

  controller.play();
  controller.play();
  controller.setSpeed('normal');
  assert.equal(stateChanges.length, 1);
  assert.ok(Object.isFrozen(stateChanges[0]));

  clock.tick(0);
  assert.equal(stateChanges.length, 1);
  clock.tick(100);
  assert.equal(stateChanges.length, 2);

  const firstSnapshot = controller.getState();
  const secondSnapshot = controller.getState();
  assert.ok(Object.isFrozen(firstSnapshot));
  assert.ok(Object.isFrozen(secondSnapshot));
  assert.notEqual(firstSnapshot, secondSnapshot);
  assert.deepEqual(firstSnapshot, secondSnapshot);
});

test('destroy is idempotent, cancels work, and makes late callbacks inert', () => {
  const { calls, clock, controller, stateChanges } = createHarness([250]);
  controller.play();
  const [[, lateCallback]] = clock.getPending();
  const callCountBeforeDestroy = calls.length;
  const changeCountBeforeDestroy = stateChanges.length;

  controller.destroy();
  controller.destroy();
  assert.equal(clock.getPending().size, 0);
  clock.elapse(500);
  lateCallback(500);
  assert.equal(calls.length, callCountBeforeDestroy);
  assert.equal(stateChanges.length, changeCountBeforeDestroy);

  [
    () => controller.play(),
    () => controller.pause(),
    () => controller.replay(),
    () => controller.previousStroke(),
    () => controller.nextStroke(),
    () => controller.setSpeed('fast'),
    () => controller.handleVisibilityChange(true),
    () => controller.getState()
  ].forEach((command) => assert.throws(command, /destroyed/));
});

test('validates renderer, timing dependencies, clock values, speed, and visibility input', () => {
  const clock = createFakeClock();
  const valid = createFakeRenderer([250]).renderer;
  const timing = {
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame
  };

  assert.throws(() => createAnimationController(null, timing), /renderer/);
  assert.throws(
    () => createAnimationController({ ...valid, setStrokeProgress: null }, timing),
    /renderer\.setStrokeProgress/
  );
  assert.throws(
    () => createAnimationController({ ...valid, getStrokeCount: () => 0 }, timing),
    /getStrokeCount/
  );
  assert.throws(
    () => createAnimationController({ ...valid, getStrokeLength: () => -1 }, timing),
    /getStrokeLength/
  );
  assert.throws(() => createAnimationController(valid, null), /options/);
  assert.throws(
    () => createAnimationController(valid, { ...timing, now: 1 }),
    /options\.now/
  );
  assert.throws(
    () => createAnimationController(valid, { ...timing, requestFrame: null }),
    /options\.requestFrame/
  );
  assert.throws(
    () => createAnimationController(valid, { ...timing, cancelFrame: null }),
    /options\.cancelFrame/
  );
  assert.throws(
    () => createAnimationController(valid, { ...timing, onStateChange: 1 }),
    /options\.onStateChange/
  );
  assert.throws(
    () => createAnimationController(valid, { ...timing, speed: 'warp' }),
    /options\.speed/
  );
  assert.throws(
    () => createAnimationController(valid, { ...timing, now: () => Number.NaN }),
    /options\.now/
  );

  const controller = createAnimationController(valid, timing);
  assert.throws(() => controller.setSpeed('warp'), /speed/);
  assert.throws(() => controller.handleVisibilityChange('yes'), /hidden/);
});

test('rejects a non-finite elapsed difference between finite clock readings', () => {
  let currentTime = -Number.MAX_VALUE;
  let pendingFrame = null;
  const { renderer } = createFakeRenderer([150]);
  let controller;
  controller = createAnimationController(renderer, {
    now: () => currentTime,
    requestFrame: (callback) => {
      pendingFrame = callback;
      return 1;
    },
    cancelFrame: () => {},
    onStateChange(state) {
      // Keeps the unfixed NaN loop bounded so the regression can fail without hanging the test process.
      if (state.status === 'completed') controller.destroy();
    }
  });
  controller.play();
  currentTime = Number.MAX_VALUE;

  assert.throws(() => pendingFrame(), /elapsed.*finite/);
});

test('does not mutate frozen renderer, options, or length input objects', () => {
  const clock = createFakeClock();
  const lengths = Object.freeze([250, 200]);
  const { renderer } = createFakeRenderer(lengths);
  Object.freeze(renderer);
  const options = Object.freeze({
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    speed: 'fast'
  });

  const controller = createAnimationController(renderer, options);
  controller.play();
  clock.tick(100);

  assert.deepEqual(lengths, [250, 200]);
  assert.equal(controller.getState().speed, 'fast');
});

test('merges the browser API without replacing an existing HanziApp namespace', async () => {
  const source = await readFile(new URL('../js/animation-controller.js', import.meta.url), 'utf8');
  const sentinel = Object.freeze({ preserved: true });
  const context = {
    window: { HanziApp: { sentinel } },
    Object,
    Number,
    Math,
    TypeError,
    RangeError,
    Error
  };

  vm.runInNewContext(source, context, { filename: 'animation-controller.js' });

  assert.equal(context.window.HanziApp.sentinel, sentinel);
  assert.equal(typeof context.window.HanziApp.createAnimationController, 'function');
  assert.equal(context.window.document, undefined);
  assert.equal(context.window.fetch, undefined);
});
