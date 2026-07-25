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
      return segment !== '' && segment !== '.' && segment !== '..';
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

  function validateMedia(media) {
    requireRecord(media, 'media');
    requireFunction(media.play, 'media.play');
    requireFunction(media.pause, 'media.pause');
    requireFunction(media.addEventListener, 'media.addEventListener');
    requireFunction(media.removeEventListener, 'media.removeEventListener');
    return media;
  }

  function isTransientError(error) {
    return Boolean(error && TRANSIENT_ERROR_NAMES.indexOf(error.name) !== -1);
  }

  function mediaEventError(event, media) {
    var candidate;
    if (event && typeof event === 'object' && event.error) candidate = event.error;
    if (!candidate) {
      try {
        candidate = media.error;
      } catch (ignored) {
        candidate = null;
      }
    }
    if (candidate instanceof Error) return candidate;

    var message = candidate && typeof candidate.message === 'string'
      ? candidate.message
      : 'Media playback failed';
    var error = new Error(message);
    if (candidate && typeof candidate.name === 'string' && candidate.name !== '') {
      error.name = candidate.name;
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
      if (!request.media) return;
      if (request.endedAttached) {
        request.endedAttached = false;
        try {
          request.media.removeEventListener('ended', request.onEnded);
        } catch (ignored) {
          // Cleanup must remain idempotent even for a partial media-like implementation.
        }
      }
      if (request.errorAttached) {
        request.errorAttached = false;
        try {
          request.media.removeEventListener('error', request.onError);
        } catch (ignored) {
          // Cleanup must remain idempotent even for a partial media-like implementation.
        }
      }
    }

    function pause(request) {
      if (!request.media || request.paused) return;
      request.paused = true;
      try {
        request.media.pause();
      } catch (ignored) {
        // A failed pause cannot be allowed to revive or retain an invalidated request.
      }
    }

    function clearActive(request, shouldPause) {
      detach(request);
      if (shouldPause) pause(request);
      if (activeRequest === request) activeRequest = null;
    }

    function cancelCurrent() {
      var request = currentRequest;
      var active = activeRequest;
      currentRequest = null;
      activeRequest = null;

      if (active) {
        detach(active);
        pause(active);
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
      if (!isTransientError(error)) unavailable.add(request.id);
      clearActive(request, true);
      currentRequest = null;
      settle(request, 'reject', error);
    }

    function markStarted(request) {
      if (!isCurrent(request)) {
        settle(request, 'resolve', false);
        return;
      }
      settle(request, 'resolve', true);
      if (activeRequest !== request) currentRequest = null;
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
      cancelCurrent();

      var request = createRequest(readingId);
      currentRequest = request;

      try {
        request.media = validateMedia(createAudio(readings.get(readingId)));
        if (!isCurrent(request)) {
          pause(request);
          return request.outcome;
        }

        request.media.preload = 'metadata';
        request.media.currentTime = 0;

        request.onEnded = function () {
          if (!isCurrent(request) || activeRequest !== request) return;
          clearActive(request, false);
          if (request.outcomeSettled) currentRequest = null;
        };
        request.onError = function (event) {
          if (!isCurrent(request) || activeRequest !== request) return;
          markFailure(request, mediaEventError(event, request.media));
        };

        request.endedAttached = true;
        request.media.addEventListener('ended', request.onEnded);
        request.errorAttached = true;
        request.media.addEventListener('error', request.onError);
        activeRequest = request;

        var playResult = request.media.play();
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
            markFailure(request, error);
            return request.outcome;
          }
          if (typeof then !== 'function') {
            markFailure(request, new TypeError('media.play(): must return a promise or undefined'));
          } else {
            Promise.resolve(playResult).then(
              function () { markStarted(request); },
              function (error) { markFailure(request, error); }
            );
          }
        }
      } catch (error) {
        markFailure(request, error);
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
