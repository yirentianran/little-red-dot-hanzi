(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.window) {
    root.window.HanziApp = Object.assign(root.window.HanziApp || {}, api);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MANIFEST_FIELDS = Object.freeze(['format', 'readings']);
  var READING_FIELDS = Object.freeze(['file']);
  var TRANSIENT_ERROR_NAMES = Object.freeze(['NotAllowedError', 'AbortError']);

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function reject(path, requirement) {
    throw new TypeError(path + ': ' + requirement);
  }

  function requireRecord(value, path) {
    if (!isRecord(value)) reject(path, 'must be an object');
    return value;
  }

  function requireFunction(value, path) {
    if (typeof value !== 'function') reject(path, 'must be a function');
    return value;
  }

  function requireOwn(record, field, path) {
    if (!Object.hasOwn(record, field)) reject(path + '.' + field, 'must be an own property');
    return record[field];
  }

  function requireExactOwnKeys(record, allowed, path) {
    Object.keys(record).forEach(function (field) {
      if (allowed.indexOf(field) === -1) reject(path + '.' + field, 'unknown field');
    });
  }

  function isRelativeLocalPath(value) {
    if (typeof value !== 'string' || value === '' || value.trim() !== value) return false;
    if (value.charAt(0) === '/' || value.indexOf('\\') !== -1) return false;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
    if (/[:?#\u0000-\u001f\u007f]/.test(value)) return false;
    var segments = value.split('/');
    return segments.every(function (segment) {
      if (segment === '' || segment === '.' || segment === '..') return false;
      var decoded;
      try {
        decoded = decodeURIComponent(segment);
      } catch (ignored) {
        return false;
      }
      return decoded !== '.'
        && decoded !== '..'
        && !/[\\/:?#\u0000-\u001f\u007f]/.test(decoded);
    });
  }

  function copyReadings(audioManifest) {
    requireRecord(audioManifest, 'audioManifest');
    requireExactOwnKeys(audioManifest, MANIFEST_FIELDS, 'audioManifest');
    var format = requireOwn(audioManifest, 'format', 'audioManifest');
    if (format !== 'audio/mpeg') reject('audioManifest.format', 'must equal audio/mpeg');
    var readings = requireOwn(audioManifest, 'readings', 'audioManifest');
    requireRecord(readings, 'audioManifest.readings');

    var copies = new Map();
    Object.keys(readings).forEach(function (readingId) {
      if (readingId.trim() === '') reject('audioManifest reading id', 'must be non-blank');
      var path = 'audioManifest.readings.' + readingId;
      var reading = readings[readingId];
      requireRecord(reading, path);
      requireExactOwnKeys(reading, READING_FIELDS, path);
      var file = requireOwn(reading, 'file', path);
      if (!isRelativeLocalPath(file)) reject(path + '.file', 'must be a relative local path');
      copies.set(readingId, file);
    });
    return copies;
  }

  function isTransientError(error) {
    if (!error) return false;
    var name;
    try {
      name = error.name;
    } catch (ignored) {
      return false;
    }
    return TRANSIENT_ERROR_NAMES.indexOf(name) !== -1;
  }

  function mediaEventError(event, media) {
    var candidate;
    try {
      if (event && typeof event === 'object') candidate = event.error;
    } catch (ignored) {
      candidate = null;
    }
    if (!candidate) {
      try {
        candidate = media.error;
      } catch (ignored) {
        candidate = null;
      }
    }
    try {
      if (candidate instanceof Error) return candidate;
    } catch (ignored) {
      candidate = null;
    }

    var message = 'Media playback failed';
    try {
      var candidateMessage = candidate && candidate.message;
      if (typeof candidateMessage === 'string') message = candidateMessage;
    } catch (ignored) {
      message = 'Media playback failed';
    }
    var error = new Error(message);
    try {
      var candidateName = candidate && candidate.name;
      if (typeof candidateName === 'string' && candidateName !== '') {
        error.name = candidateName;
      }
    } catch (ignored) {
      // The generic Error still provides a deterministic rejection reason.
    }
    return error;
  }

  function createAudioController(audioManifest, createAudio) {
    var readings = copyReadings(audioManifest);
    requireFunction(createAudio, 'createAudio');

    var unavailable = new Set();
    var generation = 0;
    var currentRequest = null;
    var activeRequest = null;
    var destroyed = false;

    function isCurrent(request) {
      return !destroyed
        && request.generation === generation
        && currentRequest === request;
    }

    function settle(request, kind, value) {
      if (request.outcomeSettled) return;
      request.outcomeSettled = true;
      if (kind === 'reject') request.reject(value);
      else request.resolve(value);
    }

    function detach(request) {
      if (!request.media || !request.removeEventListenerMethod) return;
      if (request.endedAttached) {
        request.endedAttached = false;
        try {
          request.removeEventListenerMethod.call(request.media, 'ended', request.onEnded);
        } catch (ignored) {
          // Cleanup must remain idempotent even for a partial media-like implementation.
        }
      }
      if (request.errorAttached) {
        request.errorAttached = false;
        try {
          request.removeEventListenerMethod.call(request.media, 'error', request.onError);
        } catch (ignored) {
          // Cleanup must remain idempotent even for a partial media-like implementation.
        }
      }
    }

    function pause(request, force) {
      if (!request.media || (request.paused && !force)) return;
      var pauseMethod = request.pauseMethod;
      if (!pauseMethod) {
        try {
          pauseMethod = request.media.pause;
        } catch (ignored) {
          return;
        }
        if (typeof pauseMethod !== 'function') return;
        request.pauseMethod = pauseMethod;
      }
      request.paused = true;
      try {
        pauseMethod.call(request.media);
      } catch (ignored) {
        // A failed pause cannot be allowed to revive or retain an invalidated request.
      }
    }

    function clearActive(request, shouldPause) {
      if (activeRequest === request) activeRequest = null;
      detach(request);
      if (shouldPause) pause(request, false);
    }

    function cancelCurrent() {
      var request = currentRequest;
      var active = activeRequest;
      if (currentRequest === request) currentRequest = null;
      if (activeRequest === active) activeRequest = null;

      if (active) {
        detach(active);
        pause(active, false);
      }
      if (request) {
        if (request !== active) detach(request);
        settle(request, 'resolve', false);
      }
      if (active && active !== request) settle(active, 'resolve', false);
    }

    function markFailure(request, error) {
      if (!isCurrent(request)) {
        settle(request, 'resolve', false);
        return;
      }
      var transient = isTransientError(error);
      if (!isCurrent(request)) {
        rollback(request, true);
        return;
      }
      if (!transient) unavailable.add(request.id);
      clearActive(request, true);
      if (currentRequest === request) currentRequest = null;
      settle(request, 'reject', error);
    }

    function markStarted(request) {
      if (!isCurrent(request)) {
        settle(request, 'resolve', false);
        return;
      }
      settle(request, 'resolve', true);
      if (activeRequest !== request && currentRequest === request) currentRequest = null;
    }

    function rollback(request, forcePause) {
      if (currentRequest === request) currentRequest = null;
      if (activeRequest === request) activeRequest = null;
      detach(request);
      pause(request, forcePause);
      settle(request, 'resolve', false);
    }

    function continueAfterBoundary(request, forcePause) {
      if (isCurrent(request)) return true;
      rollback(request, forcePause);
      return false;
    }

    function failSynchronousBoundary(request, error) {
      if (isCurrent(request)) markFailure(request, error);
      else rollback(request, true);
    }

    function addMediaListener(request, type, listener, attachedField) {
      request[attachedField] = true;
      try {
        request.addEventListenerMethod.call(request.media, type, listener);
      } finally {
        // A reentrant cancellation may run before the media method finishes registering.
        request[attachedField] = true;
      }
    }

    function createRequest(id) {
      var resolveOutcome;
      var rejectOutcome;
      var outcome = new Promise(function (resolve, rejectPromise) {
        resolveOutcome = resolve;
        rejectOutcome = rejectPromise;
      });
      return {
        id: id,
        generation: generation,
        media: null,
        playMethod: null,
        pauseMethod: null,
        addEventListenerMethod: null,
        removeEventListenerMethod: null,
        paused: false,
        endedAttached: false,
        errorAttached: false,
        onEnded: null,
        onError: null,
        outcome: outcome,
        outcomeSettled: false,
        resolve: resolveOutcome,
        reject: rejectOutcome
      };
    }

    function play(readingId) {
      if (destroyed) {
        return Promise.reject(new Error('Audio controller has been destroyed'));
      }
      if (typeof readingId !== 'string'
          || !readings.has(readingId)
          || unavailable.has(readingId)) {
        return Promise.resolve(false);
      }

      generation += 1;
      var transactionGeneration = generation;
      cancelCurrent();
      if (destroyed || generation !== transactionGeneration) return Promise.resolve(false);

      var request = createRequest(readingId);
      currentRequest = request;

      try {
        request.media = createAudio(readings.get(readingId));
        if (!continueAfterBoundary(request, true)) return request.outcome;
        requireRecord(request.media, 'media');
        request.playMethod = requireFunction(request.media.play, 'media.play');
        if (!continueAfterBoundary(request, true)) return request.outcome;
        request.pauseMethod = requireFunction(request.media.pause, 'media.pause');
        if (!continueAfterBoundary(request, true)) return request.outcome;
        request.addEventListenerMethod = requireFunction(
          request.media.addEventListener,
          'media.addEventListener'
        );
        if (!continueAfterBoundary(request, true)) return request.outcome;
        request.removeEventListenerMethod = requireFunction(
          request.media.removeEventListener,
          'media.removeEventListener'
        );
        if (!continueAfterBoundary(request, true)) return request.outcome;

        request.media.preload = 'metadata';
        if (!continueAfterBoundary(request, true)) return request.outcome;
        request.media.currentTime = 0;
        if (!continueAfterBoundary(request, true)) return request.outcome;

        request.onEnded = function () {
          if (!isCurrent(request) || activeRequest !== request) return;
          clearActive(request, false);
          if (request.outcomeSettled && currentRequest === request) currentRequest = null;
        };
        request.onError = function (event) {
          if (!isCurrent(request) || activeRequest !== request) return;
          var error = mediaEventError(event, request.media);
          if (!continueAfterBoundary(request, true)) return;
          markFailure(request, error);
        };

        addMediaListener(request, 'ended', request.onEnded, 'endedAttached');
        if (!continueAfterBoundary(request, true)) return request.outcome;
        addMediaListener(request, 'error', request.onError, 'errorAttached');
        if (!continueAfterBoundary(request, true)) return request.outcome;
        activeRequest = request;

        request.paused = false;
        var playResult = request.playMethod.call(request.media);
        if (!continueAfterBoundary(request, true)) return request.outcome;
        if (playResult === undefined) {
          markStarted(request);
        } else {
          var then;
          try {
            then = playResult !== null
              && (typeof playResult === 'object' || typeof playResult === 'function')
              ? playResult.then
              : null;
          } catch (error) {
            failSynchronousBoundary(request, error);
            return request.outcome;
          }
          if (!continueAfterBoundary(request, true)) return request.outcome;
          if (typeof then !== 'function') {
            markFailure(request, new TypeError('media.play(): must return a promise or undefined'));
          } else {
            var resolvePlay;
            var rejectPlay;
            var isolatedPlay = new Promise(function (resolve, rejectPromise) {
              resolvePlay = resolve;
              rejectPlay = rejectPromise;
            });
            isolatedPlay.then(
              function () { markStarted(request); },
              function (error) { markFailure(request, error); }
            );
            try {
              then.call(
                playResult,
                function () { resolvePlay(); },
                function (error) { rejectPlay(error); }
              );
            } catch (error) {
              rejectPlay(error);
            }
            continueAfterBoundary(request, true);
          }
        }
      } catch (error) {
        failSynchronousBoundary(request, error);
      }

      return request.outcome;
    }

    function stop() {
      if (destroyed) return;
      generation += 1;
      cancelCurrent();
    }

    function isAvailable(readingId) {
      return !destroyed
        && typeof readingId === 'string'
        && readings.has(readingId)
        && !unavailable.has(readingId);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      cancelCurrent();
    }

    return Object.freeze({
      play: play,
      stop: stop,
      isAvailable: isAvailable,
      destroy: destroy
    });
  }

  return Object.freeze({
    createAudioController: createAudioController
  });
}));
