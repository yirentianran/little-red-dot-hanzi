(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.window) {
    root.window.HanziApp = Object.assign(root.window.HanziApp || {}, api);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STORAGE_KEY = 'hanzi-tracking:last-route:v1';
  var MAX_STORAGE_RECONCILIATIONS = 16;
  var SPEEDS = Object.freeze(['slow', 'normal', 'fast']);
  var ROUTE_ACTIONS = Object.freeze({
    'open-lesson': Object.freeze(['lessonId', 'group']),
    'select-group': Object.freeze(['lessonId', 'group']),
    'open-character': Object.freeze(['lessonId', 'group', 'character']),
    'back-lesson': Object.freeze(['lessonId', 'group']),
    'previous-character': Object.freeze(['lessonId', 'group', 'character']),
    'next-character': Object.freeze(['lessonId', 'group', 'character'])
  });
  var API_METHODS = Object.freeze([
    'createDataStore',
    'parseHash',
    'serializeHash',
    'normalizeRoute',
    'createDirectoryModel',
    'createLessonModel',
    'createCharacterModel',
    'renderDirectory',
    'renderLesson',
    'renderCharacter',
    'createSvgRenderer',
    'createAnimationController',
    'createAudioController'
  ]);
  var bootstrappedApps = typeof WeakMap === 'function' ? new WeakMap() : null;

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

  function requireEventTarget(value, path) {
    requireRecord(value, path);
    requireFunction(value.addEventListener, path + '.addEventListener');
    requireFunction(value.removeEventListener, path + '.removeEventListener');
    return value;
  }

  function safeRead(object, property, fallback) {
    try {
      if (!object) return fallback;
      var value = object[property];
      return value !== undefined ? value : fallback;
    } catch (ignored) {
      return fallback;
    }
  }

  function safeMethod(receiver, methodName) {
    var method = safeRead(receiver, methodName, null);
    if (typeof method !== 'function') return null;
    return function () { return method.apply(receiver, arguments); };
  }

  function createApp(options) {
    requireRecord(options, 'options');
    var api = requireRecord(options.api, 'options.api');
    API_METHODS.forEach(function (method) {
      requireFunction(api[method], 'options.api.' + method);
    });
    var library = requireRecord(options.library, 'options.library');
    requireRecord(library.audio, 'options.library.audio');
    var root = requireEventTarget(options.root, 'options.root');
    var announcer = requireRecord(options.announcer, 'options.announcer');
    var windowObject = requireEventTarget(options.windowObject, 'options.windowObject');
    var documentObject = requireEventTarget(options.documentObject, 'options.documentObject');
    var location = requireRecord(options.location, 'options.location');
    var createAudio = requireFunction(options.createAudio, 'options.createAudio');
    var storage = Object.hasOwn(options, 'storage') ? options.storage : null;
    var reducedMotion = Object.hasOwn(options, 'reducedMotion')
      ? options.reducedMotion === true
      : false;

    var store = api.createDataStore(library);
    var audio = api.createAudioController(library.audio, createAudio);
    var route = null;
    var routeKey = null;
    var currentHandle = null;
    var currentModel = null;
    var renderer = null;
    var animation = null;
    var currentAnimationSession = null;
    var viewEpoch = 0;
    var transitionRevision = 0;
    var audioRequestGeneration = 0;
    var resumeRoute = null;
    var resumeRouteKey = null;
    var storageEnabled = isRecord(storage);
    var storageReconcileActive = false;
    var storageReconcileRequested = false;
    var destroyed = false;
    var lastAnimationAnnouncementKey = null;
    var installedListeners = [];

    function ownsTransition(revision) {
      return !destroyed && revision === transitionRevision;
    }

    function announce(message) {
      if (typeof message !== 'string' || message === '') return;
      try {
        announcer.textContent = message;
      } catch (ignored) {
        // Accessibility feedback must not interrupt the learning controls.
      }
    }

    function safeLocationHash() {
      var value;
      try {
        value = location.hash;
        return typeof value === 'string' ? value : String(value || '');
      } catch (ignored) {
        return '';
      }
    }

    function replaceHash(hash) {
      try {
        var replace = location.replace;
        if (typeof replace === 'function') replace.call(location, hash);
        else location.hash = hash;
      } catch (ignored) {
        // A route is already rendered synchronously even when URL mutation is blocked.
      }
    }

    function assignHash(hash) {
      try {
        location.hash = hash;
      } catch (ignored) {
        // A route is already rendered synchronously even when URL mutation is blocked.
      }
    }

    function routeInfo(candidate) {
      var parsed = typeof candidate === 'string' ? api.parseHash(candidate) : candidate;
      var normalized = api.normalizeRoute(parsed, store);
      return Object.freeze({ route: normalized, key: api.serializeHash(normalized) });
    }

    function disableStorage() {
      storageEnabled = false;
      resumeRoute = null;
      resumeRouteKey = null;
      if (route && route.view === 'directory' && currentHandle
          && typeof currentHandle.setResumeAvailable === 'function') {
        try {
          currentHandle.setResumeAvailable(false);
        } catch (ignored) {
          // The next directory render will also start with resume disabled.
        }
      }
    }

    function storageOperation(methodName, argumentsList) {
      if (!storageEnabled) return Object.freeze({ ok: false, value: null });
      try {
        var method = storage[methodName];
        if (typeof method !== 'function') {
          disableStorage();
          return Object.freeze({ ok: false, value: null });
        }
        return Object.freeze({ ok: true, value: method.apply(storage, argumentsList) });
      } catch (ignored) {
        disableStorage();
        return Object.freeze({ ok: false, value: null });
      }
    }

    function removeCorruptResume() {
      resumeRoute = null;
      resumeRouteKey = null;
      var result = storageOperation('removeItem', [STORAGE_KEY]);
      return result.ok;
    }

    function readResumeRoute() {
      var result = storageOperation('getItem', [STORAGE_KEY]);
      if (!result.ok || result.value === null) return null;
      if (typeof result.value !== 'string') {
        removeCorruptResume();
        return null;
      }
      var info = routeInfo(result.value);
      if (info.route.view !== 'character' || result.value !== info.key) {
        removeCorruptResume();
        return null;
      }
      return Object.freeze({ route: info.route, key: info.key });
    }

    function reconcileStoredResume() {
      if (!storageEnabled) return false;
      if (storageReconcileActive) {
        storageReconcileRequested = true;
        return false;
      }

      storageReconcileActive = true;
      storageReconcileRequested = true;
      var attempts = 0;
      try {
        while (storageEnabled
            && storageReconcileRequested
            && attempts < MAX_STORAGE_RECONCILIATIONS) {
          storageReconcileRequested = false;
          attempts += 1;
          var expectedRevision = transitionRevision;
          var expectedRoute = resumeRoute;
          var expectedKey = resumeRouteKey;
          if (expectedRoute && expectedKey) {
            storageOperation('setItem', [STORAGE_KEY, expectedKey]);
          } else {
            storageOperation('removeItem', [STORAGE_KEY]);
          }
          if (storageEnabled
              && (expectedRevision !== transitionRevision
                || expectedRoute !== resumeRoute
                || expectedKey !== resumeRouteKey)) {
            storageReconcileRequested = true;
          }
        }
        if (storageEnabled && storageReconcileRequested) disableStorage();
      } finally {
        storageReconcileActive = false;
        storageReconcileRequested = false;
      }
      return storageEnabled;
    }

    function saveResumeRoute(info, revision) {
      if (!ownsTransition(revision)) return false;
      if (info.route.view !== 'character' || !storageEnabled) return true;
      var result = storageOperation('setItem', [STORAGE_KEY, info.key]);
      if (!ownsTransition(revision)) {
        reconcileStoredResume();
        return false;
      }
      if (result.ok) {
        resumeRoute = info.route;
        resumeRouteKey = info.key;
      }
      return ownsTransition(revision);
    }

    function focusElement(element) {
      try {
        var focus = element && element.focus;
        if (typeof focus === 'function') focus.call(element);
      } catch (ignored) {
        // Programmatic focus is an enhancement; routing must still succeed.
      }
    }

    function cleanupPage(revision, forceSharedStop) {
      var oldAnimation = animation;
      var oldRenderer = renderer;
      var oldSession = currentAnimationSession;
      viewEpoch += 1;
      audioRequestGeneration += 1;
      currentHandle = null;
      currentModel = null;
      animation = null;
      renderer = null;
      currentAnimationSession = null;
      lastAnimationAnnouncementKey = null;
      if (oldSession) oldSession.active = false;

      try {
        if (oldAnimation && typeof oldAnimation.destroy === 'function') oldAnimation.destroy();
      } catch (ignored) {
        // Cleanup is deliberately isolated so every owned resource gets a chance to release.
      }
      try {
        if (oldRenderer && typeof oldRenderer.destroy === 'function') oldRenderer.destroy();
      } catch (ignored) {
        // Cleanup is deliberately isolated so every owned resource gets a chance to release.
      }
      if (forceSharedStop === true || ownsTransition(revision)) {
        try {
          audio.stop();
        } catch (ignored) {
          // A media implementation cannot block navigation.
        }
      }
      return forceSharedStop === true || ownsTransition(revision);
    }

    function documentIsHidden() {
      try {
        return documentObject.hidden === true;
      } catch (ignored) {
        return false;
      }
    }

    function animationAnnouncement(model, state) {
      var strokeNumber = Number.isInteger(state.strokeIndex) ? state.strokeIndex + 1 : 1;
      if (state.status === 'completed') return model.character + '，书写完成';
      if (state.status === 'paused') return '笔顺已暂停，第' + strokeNumber + '笔';
      if (state.status === 'between-strokes') return '第' + strokeNumber + '笔完成';
      if (state.status === 'playing') return '正在书写第' + strokeNumber + '笔';
      return '';
    }

    function animationOptions(epoch, session, handle, model) {
      var settings = {
        onStateChange: function (state) {
          session.callbackSequence += 1;
          var callbackSequence = session.callbackSequence;
          if (destroyed || !session.active || epoch !== viewEpoch || currentHandle !== handle) return;
          try {
            handle.setAnimationState(state);
          } catch (ignored) {
            if (destroyed
                || !session.active
                || epoch !== viewEpoch
                || currentHandle !== handle
                || callbackSequence !== session.callbackSequence) return;
            announce('笔顺状态暂时无法更新');
            return;
          }
          if (destroyed
              || !session.active
              || epoch !== viewEpoch
              || currentHandle !== handle
              || callbackSequence !== session.callbackSequence) return;
          var discreteKey = [state.status, state.mode, state.strokeIndex].join('|');
          if (discreteKey === lastAnimationAnnouncementKey) return;
          lastAnimationAnnouncementKey = discreteKey;
          announce(animationAnnouncement(model, state));
        }
      };
      var requestFrame = safeMethod(windowObject, 'requestAnimationFrame');
      var cancelFrame = safeMethod(windowObject, 'cancelAnimationFrame');
      var performanceObject = safeRead(windowObject, 'performance', null);
      var now = safeMethod(performanceObject, 'now');
      if (requestFrame) settings.requestFrame = requestFrame;
      if (cancelFrame) settings.cancelFrame = cancelFrame;
      if (now) settings.now = now;
      return settings;
    }

    function destroyCandidate(candidate) {
      try {
        if (!candidate) return;
        var destroyMethod = candidate.destroy;
        if (typeof destroyMethod === 'function') destroyMethod.call(candidate);
      } catch (ignored) {
        // Candidate cleanup is isolated from the winning transition.
      }
    }

    function degradeBoard(revision, session, handle) {
      if (!ownsTransition(revision) || currentHandle !== handle) return false;
      var ownedAnimation = animation;
      var ownedRenderer = renderer;
      session.active = false;
      animation = null;
      renderer = null;
      currentAnimationSession = null;
      destroyCandidate(ownedAnimation);
      destroyCandidate(ownedRenderer);
      if (!ownsTransition(revision) || currentHandle !== handle) return false;
      try {
        handle.showBoardError();
      } catch (ignored) {
        // Pinyin, audio, and character navigation remain usable without the board.
      }
      if (!ownsTransition(revision) || currentHandle !== handle) return false;
      announce('该字笔画暂时无法显示');
      return ownsTransition(revision) && currentHandle === handle;
    }

    function renderCharacterView(info, revision) {
      var resolved;
      var model;
      var handle;
      var epoch = viewEpoch;
      var session = { active: true, callbackSequence: 0 };
      var candidateRenderer = null;
      var candidateAnimation = null;
      var rendererAdopted = false;
      var animationAdopted = false;

      function abandonUnadoptedCandidates() {
        if (!animationAdopted) destroyCandidate(candidateAnimation);
        if (!rendererAdopted) destroyCandidate(candidateRenderer);
      }

      try {
        resolved = store.resolve(info.route);
        if (!ownsTransition(revision)) return false;
        model = api.createCharacterModel(resolved);
        if (!ownsTransition(revision)) return false;
        handle = api.renderCharacter(root, model);
        if (!ownsTransition(revision)) return false;

        currentModel = model;
        currentHandle = handle;

        var audioIsAvailable = false;
        try {
          audioIsAvailable = audio.isAvailable(model.audioId) === true;
        } catch (ignored) {
          audioIsAvailable = false;
        }
        if (!ownsTransition(revision) || currentHandle !== handle) return false;
        if (!audioIsAvailable) {
          try {
            handle.setAudioState('unavailable');
          } catch (ignored) {
            // Audio feedback failure does not make the stroke board unusable.
          }
          if (!ownsTransition(revision) || currentHandle !== handle) return false;
        }

        candidateRenderer = api.createSvgRenderer(handle.board, resolved.geometry);
        if (!ownsTransition(revision) || currentHandle !== handle) {
          abandonUnadoptedCandidates();
          return false;
        }
        renderer = candidateRenderer;
        rendererAdopted = true;

        var controllerOptions = animationOptions(epoch, session, handle, model);
        if (!ownsTransition(revision) || currentHandle !== handle) return false;
        candidateAnimation = api.createAnimationController(candidateRenderer, controllerOptions);
        if (!ownsTransition(revision) || currentHandle !== handle) {
          abandonUnadoptedCandidates();
          return false;
        }
        animation = candidateAnimation;
        currentAnimationSession = session;
        animationAdopted = true;

        var initialState = candidateAnimation.getState();
        if (!ownsTransition(revision) || currentHandle !== handle) return false;
        handle.setAnimationState(initialState);
        if (!ownsTransition(revision) || currentHandle !== handle) return false;

        if (model.group === 'write' && !reducedMotion) {
          var initiallyHidden = documentIsHidden();
          if (!ownsTransition(revision) || currentHandle !== handle) return false;
          if (initiallyHidden) {
            candidateAnimation.handleVisibilityChange(true);
            if (!ownsTransition(revision) || currentHandle !== handle) return false;
          }
          candidateAnimation.replay();
          if (!ownsTransition(revision) || currentHandle !== handle) return false;
        } else {
          candidateRenderer.showFullCharacter();
          if (!ownsTransition(revision) || currentHandle !== handle) return false;
        }
        return true;
      } catch (error) {
        if (ownsTransition(revision) && !handle) throw error;
        if (!ownsTransition(revision) || currentHandle !== handle) {
          abandonUnadoptedCandidates();
          return false;
        }
        return degradeBoard(revision, session, handle);
      }
    }

    function renderRoute(info, shouldFocus) {
      if (destroyed) return null;
      if (info.key === routeKey) {
        return { changed: false, revision: transitionRevision };
      }
      transitionRevision += 1;
      var revision = transitionRevision;
      if (routeKey === null) {
        viewEpoch += 1;
      } else {
        cleanupPage(revision, false);
      }
      if (!ownsTransition(revision)) return null;

      route = info.route;
      routeKey = info.key;

      try {
        if (route.view === 'directory') {
          var directoryModel = api.createDirectoryModel(store);
          if (!ownsTransition(revision)) return null;
          var directoryHandle = api.renderDirectory(root, directoryModel);
          if (!ownsTransition(revision)) return null;
          currentHandle = directoryHandle;
          var storedResume = readResumeRoute();
          if (!ownsTransition(revision) || currentHandle !== directoryHandle) return null;
          resumeRoute = storedResume ? storedResume.route : null;
          resumeRouteKey = storedResume ? storedResume.key : null;
          directoryHandle.setResumeAvailable(storedResume !== null);
          if (!ownsTransition(revision) || currentHandle !== directoryHandle) return null;
        } else if (route.view === 'lesson') {
          var lessonModel = api.createLessonModel(store, {
            lessonId: route.lessonId,
            group: route.group
          });
          if (!ownsTransition(revision)) return null;
          var lessonHandle = api.renderLesson(root, lessonModel);
          if (!ownsTransition(revision)) return null;
          currentHandle = lessonHandle;
        } else {
          if (!renderCharacterView(info, revision)) return null;
          if (!saveResumeRoute(info, revision)) return null;
        }
      } catch (error) {
        if (!ownsTransition(revision)) return null;
        throw error;
      }

      if (shouldFocus && currentHandle) {
        var focusedHandle = currentHandle;
        var heading = null;
        try {
          heading = focusedHandle.heading;
        } catch (ignored) {
          heading = null;
        }
        if (!ownsTransition(revision) || currentHandle !== focusedHandle) return null;
        focusElement(heading);
        if (!ownsTransition(revision) || currentHandle !== focusedHandle) return null;
      }
      return { changed: true, revision: revision };
    }

    function navigate(candidate) {
      if (destroyed) return false;
      var info;
      try {
        info = routeInfo(candidate);
      } catch (ignored) {
        info = routeInfo({ view: 'directory' });
      }
      var result = renderRoute(info, true);
      if (!result || !ownsTransition(result.revision)) return false;
      var currentHash = safeLocationHash();
      if (!ownsTransition(result.revision)) return false;
      if (currentHash !== info.key) {
        if (typeof candidate === 'string') replaceHash(info.key);
        else assignHash(info.key);
      }
      return ownsTransition(result.revision) ? result.changed : false;
    }

    function attribute(source, name) {
      if (!source) return null;
      try {
        if (typeof source.getAttribute === 'function') return source.getAttribute(name);
        if (isRecord(source) && Object.hasOwn(source, name)) return source[name];
      } catch (ignored) {
        return null;
      }
      return null;
    }

    function routeActionData(action, source) {
      var fields = ROUTE_ACTIONS[action];
      if (!fields) return null;
      var data = {};
      for (var index = 0; index < fields.length; index += 1) {
        var field = fields[index];
        var attributeName = field === 'lessonId'
          ? 'data-lesson-id'
          : field === 'character' ? 'data-character' : 'data-group';
        var value = attribute(source, attributeName);
        if ((value === null || value === undefined) && isRecord(source)) {
          value = attribute(source, field);
        }
        if (typeof value !== 'string' || value === '') return null;
        data[field] = value;
      }
      return data;
    }

    function animationCommand(methodName, argument) {
      if (!animation) return false;
      try {
        if (argument === undefined) animation[methodName]();
        else animation[methodName](argument);
        return true;
      } catch (ignored) {
        announce('笔顺控制暂时无法使用');
        return false;
      }
    }

    function toggleAnimation() {
      if (!animation) return false;
      try {
        var state = animation.getState();
        var active = state.status === 'playing'
          || state.status === 'between-strokes'
          || (state.status === 'completed' && state.mode === 'continuous');
        if (active) animation.pause();
        else if (state.status === 'paused') animation.play();
        else animation.replay();
        return true;
      } catch (ignored) {
        announce('笔顺控制暂时无法使用');
        return false;
      }
    }

    function audioAvailable(audioId) {
      try {
        return audio.isAvailable(audioId) === true;
      } catch (ignored) {
        return false;
      }
    }

    function isCurrentAudioRequest(request) {
      return !destroyed
        && request.epoch === viewEpoch
        && request.generation === audioRequestGeneration
        && request.handle === currentHandle
        && request.model === currentModel;
    }

    function settleAudioRequest(request, result, rejected) {
      if (!isCurrentAudioRequest(request)) return;
      var available = audioAvailable(request.model.audioId);
      if (!isCurrentAudioRequest(request)) return;
      var state = !available ? 'unavailable' : (rejected || result !== true ? 'error' : 'ready');
      try {
        request.handle.setAudioState(state);
      } catch (ignored) {
        return;
      }
      if (!isCurrentAudioRequest(request)) return;
      if (state === 'ready') announce(request.model.character + '的读音已开始播放');
      if (state === 'error') announce('读音播放失败，可以重试');
      if (state === 'unavailable') announce('该字读音暂不可用');
    }

    function playCurrentAudio() {
      if (!currentHandle || !currentModel || route.view !== 'character') return false;
      audioRequestGeneration += 1;
      var request = {
        epoch: viewEpoch,
        generation: audioRequestGeneration,
        handle: currentHandle,
        model: currentModel
      };
      if (!audioAvailable(currentModel.audioId)) {
        settleAudioRequest(request, false, false);
        return true;
      }
      if (!isCurrentAudioRequest(request)) return false;
      try {
        currentHandle.setAudioState('loading');
      } catch (ignored) {
        return false;
      }
      if (!isCurrentAudioRequest(request)) return false;

      var outcome;
      try {
        outcome = audio.play(currentModel.audioId);
      } catch (error) {
        settleAudioRequest(request, error, true);
        return true;
      }
      Promise.resolve(outcome).then(
        function (result) { settleAudioRequest(request, result, false); },
        function (error) { settleAudioRequest(request, error, true); }
      );
      return true;
    }

    function dispatch(action, source) {
      if (destroyed) return false;
      if (isRecord(action)) {
        if (!Object.hasOwn(action, 'action')) return false;
        source = action;
        try {
          action = action.action;
        } catch (ignored) {
          return false;
        }
      }
      if (typeof action !== 'string') return false;

      if (action === 'go-directory') return navigate({ view: 'directory' });
      if (action === 'resume-learning') {
        return resumeRoute ? navigate(resumeRoute) : false;
      }
      if (Object.hasOwn(ROUTE_ACTIONS, action)) {
        var data = routeActionData(action, source);
        if (!data) return false;
        if (action === 'open-lesson' || action === 'select-group' || action === 'back-lesson') {
          return navigate({ view: 'lesson', lessonId: data.lessonId, group: data.group });
        }
        return navigate({
          view: 'character',
          lessonId: data.lessonId,
          group: data.group,
          character: data.character
        });
      }
      if (action === 'play-audio') return playCurrentAudio();
      if (action === 'toggle-play') return toggleAnimation();
      if (action === 'replay') return animationCommand('replay');
      if (action === 'previous-stroke') return animationCommand('previousStroke');
      if (action === 'next-stroke') return animationCommand('nextStroke');
      if (action === 'set-speed') {
        var speed = attribute(source, 'data-speed');
        if ((speed === null || speed === undefined) && isRecord(source)) {
          speed = attribute(source, 'speed');
        }
        if (SPEEDS.indexOf(speed) === -1) return false;
        return animationCommand('setSpeed', speed);
      }
      return false;
    }

    function findActionTarget(target) {
      var node = target;
      var candidate = null;
      while (node) {
        if (!candidate && attribute(node, 'data-action') !== null) candidate = node;
        if (node === root) return candidate;
        try {
          node = node.parentNode;
        } catch (ignored) {
          return null;
        }
      }
      return null;
    }

    function isDisabled(element) {
      try {
        return (typeof element.hasAttribute === 'function' && element.hasAttribute('disabled'))
          || element.disabled === true;
      } catch (ignored) {
        return true;
      }
    }

    function handleRootClick(event) {
      var target = findActionTarget(event && event.target);
      if (!target || isDisabled(target)) return;
      var action = attribute(target, 'data-action');
      dispatch(action, target);
    }

    function handleHashChange() {
      if (destroyed) return;
      var hash = safeLocationHash();
      if (hash === '#app') {
        focusElement(root);
        if (routeKey !== null) replaceHash(routeKey);
        return;
      }
      var info;
      try {
        info = routeInfo(hash);
      } catch (ignored) {
        info = routeInfo({ view: 'directory' });
      }
      var result = renderRoute(info, true);
      if (!result || !ownsTransition(result.revision)) return;
      if (hash !== info.key) replaceHash(info.key);
    }

    function handleVisibilityChange() {
      if (!animation || destroyed) return;
      try {
        animation.handleVisibilityChange(documentIsHidden());
      } catch (ignored) {
        announce('笔顺播放状态暂时无法更新');
      }
    }

    function getRoute() {
      return route;
    }

    function debugControllers() {
      return Object.freeze({ renderer: renderer, animation: animation, audio: audio });
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      transitionRevision += 1;
      removeInstalledListeners();
      if (routeKey !== null) cleanupPage(transitionRevision, true);
      try { audio.destroy(); } catch (ignored) {}
    }

    function removeInstalledListeners() {
      for (var index = installedListeners.length - 1; index >= 0; index -= 1) {
        var record = installedListeners[index];
        try {
          record.target.removeEventListener(record.type, record.listener);
        } catch (ignored) {
          // Listener rollback must continue through all prior successful installs.
        }
      }
      installedListeners = [];
    }

    function installListener(target, type, listener) {
      var record = { target: target, type: type, listener: listener };
      installedListeners.push(record);
      target.addEventListener(type, listener);
    }

    try {
      installListener(root, 'click', handleRootClick);
      installListener(windowObject, 'hashchange', handleHashChange);
      installListener(documentObject, 'visibilitychange', handleVisibilityChange);
    } catch (error) {
      removeInstalledListeners();
      try { audio.destroy(); } catch (ignored) {}
      throw error;
    }

    var initialCandidate = Object.hasOwn(options, 'initialRoute')
      ? options.initialRoute
      : safeLocationHash();
    var initialInfo;
    try {
      initialInfo = routeInfo(initialCandidate);
    } catch (ignored) {
      initialInfo = routeInfo({ view: 'directory' });
    }
    var initialResult;
    try {
      initialResult = renderRoute(initialInfo, false);
    } catch (error) {
      destroy();
      throw error;
    }
    if (initialResult && ownsTransition(initialResult.revision)) {
      var initialHash = safeLocationHash();
      if (ownsTransition(initialResult.revision) && initialHash !== initialInfo.key) {
        replaceHash(initialInfo.key);
      }
    }

    return Object.freeze({
      navigate: navigate,
      dispatch: dispatch,
      getRoute: getRoute,
      debugControllers: debugControllers,
      destroy: destroy
    });
  }

  function bootstrapApp(windowObject) {
    var candidate = windowObject;
    if (!candidate) {
      var globalObject = typeof globalThis !== 'undefined' ? globalThis : null;
      candidate = safeRead(globalObject, 'window', null);
    }
    requireRecord(candidate, 'windowObject');
    if (bootstrappedApps && bootstrappedApps.has(candidate)) {
      return bootstrappedApps.get(candidate);
    }

    var documentObject = requireRecord(safeRead(candidate, 'document', null), 'windowObject.document');
    var getElementById = requireFunction(
      safeRead(documentObject, 'getElementById', null),
      'windowObject.document.getElementById'
    );
    var root = getElementById.call(documentObject, 'app');
    var announcer = getElementById.call(documentObject, 'announcer');
    if (!root) reject('document #app', 'must exist');
    if (!announcer) reject('document #announcer', 'must exist');

    var api = requireRecord(safeRead(candidate, 'HanziApp', null), 'windowObject.HanziApp');
    var library = requireRecord(
      safeRead(candidate, 'HANZI_LIBRARY', null),
      'windowObject.HANZI_LIBRARY'
    );
    var location = safeRead(candidate, 'location', { hash: '' });
    var storage = safeRead(candidate, 'localStorage', null);
    var matchMedia = safeMethod(candidate, 'matchMedia');
    var reducedMotion = false;
    if (matchMedia) {
      try {
        reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches === true;
      } catch (ignored) {
        reducedMotion = false;
      }
    }
    var AudioConstructor = safeRead(candidate, 'Audio', null);
    var createAudio = function (path) {
      if (typeof AudioConstructor !== 'function') throw new Error('Audio is unavailable');
      return new AudioConstructor(path);
    };
    var instance = createApp({
      api: api,
      library: library,
      root: root,
      announcer: announcer,
      windowObject: candidate,
      documentObject: documentObject,
      location: location,
      storage: storage,
      createAudio: createAudio,
      reducedMotion: reducedMotion
    });
    if (bootstrappedApps) bootstrappedApps.set(candidate, instance);
    return instance;
  }

  return Object.freeze({
    createApp: createApp,
    bootstrapApp: bootstrapApp
  });
}));
