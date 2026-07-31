(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.window) {
    root.window.HanziApp = Object.assign(root.window.HanziApp || {}, api);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RENDERER_METHODS = Object.freeze([
    'getStrokeCount',
    'getStrokeLength',
    'setStrokeProgress',
    'showCompletedThrough',
    'showFullCharacter'
  ]);
  var SPEED_MULTIPLIERS = Object.freeze({
    slow: 1.45,
    normal: 1,
    fast: 0.7
  });
  var MILLISECONDS_PER_LENGTH_UNIT = 3;
  var MINIMUM_STROKE_DURATION = 300;
  var MAXIMUM_STROKE_DURATION = 1200;
  var BETWEEN_STROKE_PAUSE = 180;
  var COMPLETED_CHARACTER_PAUSE = 900;
  var TIME_EPSILON = 1e-7;

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function reject(path, requirement) {
    throw new TypeError(path + ': ' + requirement);
  }

  function requireFunction(value, path) {
    if (typeof value !== 'function') reject(path, 'must be a function');
    return value;
  }

  function requireSpeed(speed, path) {
    if (typeof speed !== 'string' || !Object.hasOwn(SPEED_MULTIPLIERS, speed)) {
      reject(path, 'must equal slow, normal, or fast');
    }
    return speed;
  }

  function defaultNow() {
    var globalObject = typeof globalThis !== 'undefined' ? globalThis : null;
    if (globalObject && globalObject.performance
        && typeof globalObject.performance.now === 'function') {
      return function () { return globalObject.performance.now(); };
    }
    return function () { return Date.now(); };
  }

  function defaultFrameFunction(name) {
    var globalObject = typeof globalThis !== 'undefined' ? globalThis : null;
    if (!globalObject || typeof globalObject[name] !== 'function') return null;
    return function () {
      return globalObject[name].apply(globalObject, arguments);
    };
  }

  function durationFromLength(length) {
    return Math.min(
      MAXIMUM_STROKE_DURATION,
      Math.max(MINIMUM_STROKE_DURATION, length * MILLISECONDS_PER_LENGTH_UNIT)
    );
  }

  function reduceFullCycles(elapsed, cycleDuration) {
    var tolerance = Math.min(
      cycleDuration / 2,
      Math.max(TIME_EPSILON, Number.EPSILON * Math.abs(elapsed) * 4)
    );
    if (elapsed + tolerance < cycleDuration) return elapsed;
    var remainder = elapsed % cycleDuration;
    if (remainder <= tolerance || cycleDuration - remainder <= tolerance) return 0;
    return remainder;
  }

  function createAnimationController(renderer, options) {
    if (!isRecord(renderer)) reject('renderer', 'must be an object');
    RENDERER_METHODS.forEach(function (method) {
      requireFunction(renderer[method], 'renderer.' + method);
    });

    var settings;
    if (options === undefined) {
      settings = {};
    } else {
      if (!isRecord(options)) reject('options', 'must be an object when provided');
      settings = options;
    }

    var now = Object.hasOwn(settings, 'now')
      ? requireFunction(settings.now, 'options.now')
      : defaultNow();
    var requestFrame = Object.hasOwn(settings, 'requestFrame')
      ? requireFunction(settings.requestFrame, 'options.requestFrame')
      : defaultFrameFunction('requestAnimationFrame');
    var cancelFrame = Object.hasOwn(settings, 'cancelFrame')
      ? requireFunction(settings.cancelFrame, 'options.cancelFrame')
      : defaultFrameFunction('cancelAnimationFrame');
    var onStateChange = Object.hasOwn(settings, 'onStateChange')
      ? requireFunction(settings.onStateChange, 'options.onStateChange')
      : function () {};
    var initialSpeed = Object.hasOwn(settings, 'speed')
      ? requireSpeed(settings.speed, 'options.speed')
      : 'normal';

    requireFunction(requestFrame, 'options.requestFrame');
    requireFunction(cancelFrame, 'options.cancelFrame');

    var strokeCount = renderer.getStrokeCount();
    if (!Number.isInteger(strokeCount) || strokeCount <= 0) {
      reject('renderer.getStrokeCount()', 'must return a positive integer');
    }
    var strokeDurations = [];
    for (var lengthIndex = 0; lengthIndex < strokeCount; lengthIndex += 1) {
      var length = renderer.getStrokeLength(lengthIndex);
      if (!Number.isFinite(length) || length < 0) {
        reject(
          'renderer.getStrokeLength(' + lengthIndex + ')',
          'must return a finite non-negative number'
        );
      }
      strokeDurations.push(durationFromLength(length));
    }
    var baseContinuousCycleDuration = strokeDurations.reduce(function (total, duration) {
      return total + duration;
    }, COMPLETED_CHARACTER_PAUSE + (BETWEEN_STROKE_PAUSE * (strokeCount - 1)));

    var lastClockTime;
    function readNow() {
      var value = now();
      if (!Number.isFinite(value)) reject('options.now()', 'must return a finite number');
      if (lastClockTime !== undefined && value < lastClockTime) {
        throw new RangeError('options.now(): must be monotonic');
      }
      lastClockTime = value;
      return value;
    }

    var phaseAnchor = readNow();
    var state = {
      status: 'idle',
      mode: 'continuous',
      strokeIndex: 0,
      progress: 0,
      speed: initialSpeed
    };
    var phase = 'stroke';
    var delayProgress = 0;
    var playbackIntent = false;
    var hidden = false;
    var destroyed = false;
    var activeFrame = null;
    var frameGeneration = 0;
    var timelineRevision = 0;
    var lastPublishedKey = stateKey(state);

    renderer.setStrokeProgress(0, 0);

    function assertAlive() {
      if (destroyed) throw new Error('Animation controller has been destroyed');
    }

    function stateKey(candidate) {
      return [
        candidate.status,
        candidate.mode,
        candidate.strokeIndex,
        candidate.progress,
        candidate.speed
      ].join('|');
    }

    function snapshot() {
      return Object.freeze({
        status: state.status,
        mode: state.mode,
        strokeIndex: state.strokeIndex,
        progress: state.progress,
        speed: state.speed
      });
    }

    function publish(expectedRevision) {
      var key = stateKey(state);
      if (key === lastPublishedKey) return timelineRevision === expectedRevision;
      lastPublishedKey = key;
      onStateChange(snapshot());
      return timelineRevision === expectedRevision;
    }

    function statusForPhase() {
      if (phase === 'between') return 'between-strokes';
      if (phase === 'completed') return 'completed';
      return 'playing';
    }

    function clampUnit(value) {
      return Math.min(1, Math.max(0, value));
    }

    function renderStrokeProgress(progress, expectedRevision) {
      state.progress = clampUnit(progress);
      renderer.setStrokeProgress(state.strokeIndex, state.progress);
      return publish(expectedRevision);
    }

    function finishStroke(expectedRevision) {
      state.progress = 1;
      renderer.setStrokeProgress(state.strokeIndex, 1);
      renderer.showCompletedThrough(state.strokeIndex);

      if (state.mode === 'step') {
        playbackIntent = false;
        phase = 'stroke';
        delayProgress = 0;
        state.status = 'paused';
        return publish(expectedRevision);
      }

      delayProgress = 0;
      if (state.strokeIndex === strokeCount - 1) {
        phase = 'completed';
        state.status = 'completed';
        renderer.showFullCharacter();
      } else {
        phase = 'between';
        state.status = 'between-strokes';
      }
      return publish(expectedRevision);
    }

    function startNextStroke(expectedRevision) {
      phase = 'stroke';
      delayProgress = 0;
      state.strokeIndex += 1;
      state.progress = 0;
      state.status = 'playing';
      renderer.setStrokeProgress(state.strokeIndex, 0);
      return publish(expectedRevision);
    }

    function startLoop(expectedRevision) {
      phase = 'stroke';
      delayProgress = 0;
      state.strokeIndex = 0;
      state.progress = 0;
      state.status = 'playing';
      renderer.setStrokeProgress(0, 0);
      return publish(expectedRevision);
    }

    function advanceElapsed(elapsed, expectedRevision) {
      if (!Number.isFinite(elapsed)) {
        throw new RangeError('elapsed animation time must be finite');
      }
      var remaining = Math.max(0, elapsed);
      if (remaining <= TIME_EPSILON) return timelineRevision === expectedRevision;

      if (state.mode === 'continuous') {
        var cycleDuration = baseContinuousCycleDuration * SPEED_MULTIPLIERS[state.speed];
        remaining = reduceFullCycles(remaining, cycleDuration);
        if (remaining <= TIME_EPSILON) return timelineRevision === expectedRevision;
      }

      while (playbackIntent && !destroyed) {
        if (phase === 'stroke') {
          var duration = strokeDurations[state.strokeIndex] * SPEED_MULTIPLIERS[state.speed];
          var neededForStroke = (1 - state.progress) * duration;
          if (remaining + TIME_EPSILON < neededForStroke) {
            if (remaining > 0) {
              return renderStrokeProgress(
                state.progress + (remaining / duration),
                expectedRevision
              );
            }
            return timelineRevision === expectedRevision;
          }
          remaining = Math.max(0, remaining - neededForStroke);
          if (!finishStroke(expectedRevision)) return false;
          if (!playbackIntent || remaining <= TIME_EPSILON) return true;
        } else if (phase === 'between') {
          var gapDuration = BETWEEN_STROKE_PAUSE * SPEED_MULTIPLIERS[state.speed];
          var neededForGap = (1 - delayProgress) * gapDuration;
          if (remaining + TIME_EPSILON < neededForGap) {
            delayProgress = clampUnit(delayProgress + (remaining / gapDuration));
            return timelineRevision === expectedRevision;
          }
          remaining = Math.max(0, remaining - neededForGap);
          if (!startNextStroke(expectedRevision)) return false;
          if (remaining <= TIME_EPSILON) return true;
        } else {
          var holdDuration = COMPLETED_CHARACTER_PAUSE * SPEED_MULTIPLIERS[state.speed];
          var neededForHold = (1 - delayProgress) * holdDuration;
          if (remaining + TIME_EPSILON < neededForHold) {
            delayProgress = clampUnit(delayProgress + (remaining / holdDuration));
            return timelineRevision === expectedRevision;
          }
          remaining = Math.max(0, remaining - neededForHold);
          if (!startLoop(expectedRevision)) return false;
          if (remaining <= TIME_EPSILON) return true;
        }
      }
      return timelineRevision === expectedRevision;
    }

    function cancelScheduledFrame() {
      if (activeFrame === null) return;
      var token = activeFrame;
      activeFrame = null;
      frameGeneration += 1;
      cancelFrame(token.handle);
    }

    function scheduleFrame() {
      if (destroyed || hidden || !playbackIntent || activeFrame !== null) return;
      var token = { generation: frameGeneration, handle: undefined };
      activeFrame = token;
      token.handle = requestFrame(function () {
        if (destroyed || activeFrame !== token || token.generation !== frameGeneration) return;
        activeFrame = null;
        var currentTime = readNow();
        var elapsed = currentTime - phaseAnchor;
        phaseAnchor = currentTime;
        advanceElapsed(elapsed, timelineRevision);
        scheduleFrame();
      });
    }

    function settleToNow(expectedRevision) {
      var currentTime = readNow();
      var elapsed = currentTime - phaseAnchor;
      phaseAnchor = currentTime;
      return advanceElapsed(elapsed, expectedRevision);
    }

    function play() {
      assertAlive();
      if (playbackIntent) return false;
      var currentTime = readNow();
      timelineRevision += 1;
      var commandRevision = timelineRevision;
      if (state.mode === 'step' && phase === 'stroke' && state.progress === 1) {
        state.progress = 0;
        renderer.setStrokeProgress(state.strokeIndex, 0);
      }
      playbackIntent = true;
      state.status = statusForPhase();
      phaseAnchor = currentTime;
      if (publish(commandRevision)) scheduleFrame();
      return true;
    }

    function pause() {
      assertAlive();
      if (!playbackIntent) return false;
      timelineRevision += 1;
      var commandRevision = timelineRevision;
      if (!hidden && !settleToNow(commandRevision)) return true;
      cancelScheduledFrame();
      playbackIntent = false;
      state.status = 'paused';
      publish(commandRevision);
      return true;
    }

    function replay() {
      assertAlive();
      var currentTime = readNow();
      timelineRevision += 1;
      var commandRevision = timelineRevision;
      cancelScheduledFrame();
      phase = 'stroke';
      delayProgress = 0;
      playbackIntent = true;
      state.status = 'playing';
      state.mode = 'continuous';
      state.strokeIndex = 0;
      state.progress = 0;
      phaseAnchor = currentTime;
      renderer.setStrokeProgress(0, 0);
      if (publish(commandRevision)) scheduleFrame();
    }

    function playStep(targetIndex) {
      var currentTime = readNow();
      timelineRevision += 1;
      var commandRevision = timelineRevision;
      cancelScheduledFrame();
      phase = 'stroke';
      delayProgress = 0;
      playbackIntent = true;
      state.status = 'playing';
      state.mode = 'step';
      state.strokeIndex = targetIndex;
      state.progress = 0;
      phaseAnchor = currentTime;
      renderer.setStrokeProgress(targetIndex, 0);
      if (publish(commandRevision)) scheduleFrame();
      return true;
    }

    function previousStroke() {
      assertAlive();
      if (state.strokeIndex === 0) return false;
      return playStep(state.strokeIndex - 1);
    }

    function nextStroke() {
      assertAlive();
      if (state.strokeIndex === strokeCount - 1) return false;
      return playStep(state.strokeIndex + 1);
    }

    function setSpeed(speed) {
      assertAlive();
      requireSpeed(speed, 'speed');
      if (state.speed === speed) return false;
      timelineRevision += 1;
      var commandRevision = timelineRevision;

      if (playbackIntent && !hidden) {
        cancelScheduledFrame();
        if (!settleToNow(commandRevision)) return true;
      }
      state.speed = speed;
      if (publish(commandRevision)) scheduleFrame();
      return true;
    }

    function handleVisibilityChange(isHidden) {
      assertAlive();
      if (typeof isHidden !== 'boolean') reject('hidden', 'must be a boolean');
      if (hidden === isHidden) return false;
      timelineRevision += 1;
      var commandRevision = timelineRevision;

      if (isHidden) {
        var wasPlaying = playbackIntent;
        if (wasPlaying) cancelScheduledFrame();
        hidden = true;
        if (wasPlaying) {
          if (!settleToNow(commandRevision)) return true;
        }
      } else {
        hidden = false;
        if (playbackIntent) {
          phaseAnchor = readNow();
          scheduleFrame();
        }
      }
      return true;
    }

    function getState() {
      assertAlive();
      return snapshot();
    }

    function destroy() {
      if (destroyed) return;
      timelineRevision += 1;
      destroyed = true;
      playbackIntent = false;
      cancelScheduledFrame();
    }

    return Object.freeze({
      play: play,
      pause: pause,
      replay: replay,
      previousStroke: previousStroke,
      nextStroke: nextStroke,
      setSpeed: setSpeed,
      handleVisibilityChange: handleVisibilityChange,
      getState: getState,
      destroy: destroy
    });
  }

  return Object.freeze({
    createAnimationController: createAnimationController
  });
}));
