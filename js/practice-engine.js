(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.window) {
    root.window.HanziApp = Object.assign(root.window.HanziApp || {}, api);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  var HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
  var PADDING = 24;
  var LENIENCY = 1;
  var ERROR_DURATION = 240;
  var BRAND_RED = '#d92d20';
  var HAN_CHARACTER = /^\p{Script=Han}$/u;
  var OPTION_FIELDS = Object.freeze([
    'target', 'HanziWriter', 'character', 'geometry', 'onEvent',
    'reducedMotion', 'setTimeout', 'clearTimeout'
  ]);
  var REQUIRED_OPTION_FIELDS = Object.freeze([
    'target', 'HanziWriter', 'character', 'geometry', 'onEvent'
  ]);
  var GEOMETRY_FIELDS = Object.freeze(['strokeCount', 'strokes', 'medians']);
  var START_FIELDS = Object.freeze(['phase', 'strokeIndex']);
  var LISTENER_TYPES = Object.freeze([
    'pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave'
  ]);

  function reject(path, requirement) {
    throw new TypeError(path + ': ' + requirement);
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      var prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    } catch (_error) {
      return false;
    }
  }

  function requirePlainObject(value, path) {
    if (!isPlainObject(value)) reject(path, 'must be a plain object');
  }

  function ownDataValue(value, key, path) {
    var descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_error) {
      reject(path + '.' + key, 'must be an own data property');
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      reject(path + '.' + key, 'must be an own data property');
    }
    return descriptor.value;
  }

  function requireExactFields(value, required, allowed, path) {
    requirePlainObject(value, path);
    var names;
    var symbols;
    try {
      names = Object.getOwnPropertyNames(value);
      symbols = Object.getOwnPropertySymbols(value);
    } catch (_error) {
      reject(path, 'must expose own fields');
    }
    if (symbols.length !== 0) reject(path, 'must not contain symbol fields');
    names.forEach(function (name) {
      if (allowed.indexOf(name) === -1) reject(path + '.' + name, 'is not allowed');
      ownDataValue(value, name, path);
    });
    required.forEach(function (name) { ownDataValue(value, name, path); });
  }

  function requireRegularArray(value, path) {
    if (!Array.isArray(value)) reject(path, 'must be an array');
    var names;
    var symbols;
    try {
      names = Object.getOwnPropertyNames(value);
      symbols = Object.getOwnPropertySymbols(value);
    } catch (_error) {
      reject(path, 'must be a regular array');
    }
    if (symbols.length !== 0 || names.length !== value.length + 1 || names.indexOf('length') === -1) {
      reject(path, 'must contain only own array elements');
    }
    for (var index = 0; index < value.length; index += 1) {
      ownDataValue(value, String(index), path);
    }
  }

  function requireFunction(value, path) {
    if (typeof value !== 'function') reject(path, 'must be a function');
    return value;
  }

  function requirePublicFunction(value, key, path) {
    if ((value === null || (typeof value !== 'object' && typeof value !== 'function'))
        || typeof value[key] !== 'function') {
      reject(path + '.' + key, 'must be a function');
    }
  }

  function requireTarget(target) {
    if (target === null || typeof target !== 'object') reject('options.target', 'must be a DOM-like element');
    if (!target.ownerDocument || typeof target.ownerDocument.createElementNS !== 'function') {
      reject('options.target.ownerDocument.createElementNS', 'must be a function');
    }
    ['addEventListener', 'removeEventListener', 'appendChild', 'getBoundingClientRect'].forEach(function (method) {
      if (typeof target[method] !== 'function') reject('options.target.' + method, 'must be a function');
    });
    if (!target.style || typeof target.style !== 'object') reject('options.target.style', 'must be an object');
    return target;
  }

  function requireHanziWriter(value) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      reject('options.HanziWriter', 'must be an object');
    }
    var create = ownDataValue(value, 'create', 'options.HanziWriter');
    var getScalingTransform = ownDataValue(value, 'getScalingTransform', 'options.HanziWriter');
    requireFunction(create, 'options.HanziWriter.create');
    requireFunction(getScalingTransform, 'options.HanziWriter.getScalingTransform');
    return Object.freeze({
      object: value,
      create: create,
      getScalingTransform: getScalingTransform
    });
  }

  function requireCharacter(value) {
    if (typeof value !== 'string' || !HAN_CHARACTER.test(value)) {
      reject('options.character', 'must be exactly one Unicode Han character');
    }
    return value;
  }

  function requirePathString(value, path) {
    if (typeof value !== 'string' || value.trim() === '' || !/^[Mm]/.test(value.trim())) {
      reject(path, 'must be non-empty SVG path data');
    }
    return value;
  }

  function cloneGeometry(value) {
    requireExactFields(value, GEOMETRY_FIELDS, GEOMETRY_FIELDS, 'options.geometry');
    var strokeCount = ownDataValue(value, 'strokeCount', 'options.geometry');
    var strokes = ownDataValue(value, 'strokes', 'options.geometry');
    var medians = ownDataValue(value, 'medians', 'options.geometry');
    if (!Number.isSafeInteger(strokeCount) || strokeCount <= 0) {
      reject('options.geometry.strokeCount', 'must be a positive safe integer');
    }
    requireRegularArray(strokes, 'options.geometry.strokes');
    requireRegularArray(medians, 'options.geometry.medians');
    if (strokes.length !== strokeCount || medians.length !== strokeCount) {
      reject('options.geometry', 'strokeCount, strokes, and medians must agree');
    }
    var strokeCopies = [];
    var medianCopies = [];
    for (var index = 0; index < strokeCount; index += 1) {
      strokeCopies.push(requirePathString(
        ownDataValue(strokes, String(index), 'options.geometry.strokes'),
        'options.geometry.strokes[' + index + ']'
      ));
      var median = ownDataValue(medians, String(index), 'options.geometry.medians');
      requireRegularArray(median, 'options.geometry.medians[' + index + ']');
      if (median.length === 0) reject('options.geometry.medians[' + index + ']', 'must not be empty');
      var points = [];
      for (var pointIndex = 0; pointIndex < median.length; pointIndex += 1) {
        var pointPath = 'options.geometry.medians[' + index + '][' + pointIndex + ']';
        var point = ownDataValue(median, String(pointIndex), 'options.geometry.medians[' + index + ']');
        requireRegularArray(point, pointPath);
        if (point.length !== 2) reject(pointPath, 'must contain x and y');
        var x = ownDataValue(point, '0', pointPath);
        var y = ownDataValue(point, '1', pointPath);
        if (!Number.isFinite(x) || !Number.isFinite(y)) reject(pointPath, 'must contain finite coordinates');
        points.push(Object.freeze([x, y]));
      }
      medianCopies.push(Object.freeze(points));
    }
    return Object.freeze({
      strokeCount: strokeCount,
      strokes: Object.freeze(strokeCopies),
      medians: Object.freeze(medianCopies)
    });
  }

  function readDimensions(target) {
    var rect = target.getBoundingClientRect();
    var width = rect && rect.width;
    var height = rect && rect.height;
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new RangeError('options.target.getBoundingClientRect(): width and height must be positive finite numbers');
    }
    return { width: width, height: height };
  }

  function setAttribute(element, name, value) {
    if (typeof element.setAttributeNS === 'function') element.setAttributeNS(null, name, value);
    else element.setAttribute(name, value);
  }

  function removeNode(node) {
    if (!node || !node.parentNode) return;
    if (typeof node.remove === 'function') node.remove();
    else node.parentNode.removeChild(node);
  }

  function freezeDrawnPath(value) {
    if (!isPlainObject(value)) return null;
    var pathString;
    var points;
    try {
      pathString = ownDataValue(value, 'pathString', 'callback.drawnPath');
      points = ownDataValue(value, 'points', 'callback.drawnPath');
      if (typeof pathString !== 'string' || pathString.trim() === '') return null;
      requireRegularArray(points, 'callback.drawnPath.points');
    } catch (_error) {
      return null;
    }
    var copies = [];
    for (var index = 0; index < points.length; index += 1) {
      var point;
      var x;
      var y;
      try {
        point = ownDataValue(points, String(index), 'callback.drawnPath.points');
        if (!isPlainObject(point)) return null;
        x = ownDataValue(point, 'x', 'callback.drawnPath.points[' + index + ']');
        y = ownDataValue(point, 'y', 'callback.drawnPath.points[' + index + ']');
      } catch (_error) {
        return null;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      copies.push(Object.freeze({ x: x, y: y }));
    }
    return Object.freeze({ pathString: pathString, points: Object.freeze(copies) });
  }

  function requiredSafeInteger(source, key, destination) {
    var descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(source, key);
    } catch (_error) {
      return false;
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')
        || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) return false;
    destination[key] = descriptor.value;
    return true;
  }

  function normalizeStrokeEvent(type, data, expectedStroke) {
    if (!isPlainObject(data)) return null;
    var strokeNum;
    try {
      strokeNum = ownDataValue(data, 'strokeNum', 'callback');
    } catch (_error) {
      return null;
    }
    if (!Number.isSafeInteger(strokeNum) || strokeNum !== expectedStroke) return null;
    var event = { type: type, strokeNum: strokeNum };
    if (!requiredSafeInteger(data, 'mistakesOnStroke', event)
        || !requiredSafeInteger(data, 'totalMistakes', event)
        || !requiredSafeInteger(data, 'strokesRemaining', event)) return null;
    var drawnDescriptor;
    try {
      drawnDescriptor = Object.getOwnPropertyDescriptor(data, 'drawnPath');
    } catch (_error) {
      return null;
    }
    if (!drawnDescriptor || !Object.hasOwn(drawnDescriptor, 'value')) return null;
    var drawnPath = freezeDrawnPath(drawnDescriptor.value);
    if (!drawnPath) return null;
    event.drawnPath = drawnPath;
    if (type === 'stroke-mistake') {
      var backwards;
      try {
        backwards = ownDataValue(data, 'isBackwards', 'callback');
      } catch (_error) {
        return null;
      }
      if (typeof backwards !== 'boolean' || !event.drawnPath) return null;
      event.isBackwards = backwards;
    }
    return Object.freeze(event);
  }

  function normalizeCompleteEvent(data) {
    if (!isPlainObject(data)) return null;
    var event = { type: 'character-complete' };
    if (!requiredSafeInteger(data, 'totalMistakes', event)) return null;
    return Object.freeze(event);
  }

  function createPracticeEngine(options) {
    requireExactFields(options, REQUIRED_OPTION_FIELDS, OPTION_FIELDS, 'options');
    var target = requireTarget(ownDataValue(options, 'target', 'options'));
    var hanziApi = requireHanziWriter(ownDataValue(options, 'HanziWriter', 'options'));
    var character = requireCharacter(ownDataValue(options, 'character', 'options'));
    var geometry = cloneGeometry(ownDataValue(options, 'geometry', 'options'));
    var onEvent = requireFunction(ownDataValue(options, 'onEvent', 'options'), 'options.onEvent');
    var reducedMotion = Object.hasOwn(options, 'reducedMotion')
      ? ownDataValue(options, 'reducedMotion', 'options') : false;
    if (typeof reducedMotion !== 'boolean') reject('options.reducedMotion', 'must be a boolean');
    var globalObject = typeof globalThis !== 'undefined' ? globalThis : null;
    var scheduleTimeout = Object.hasOwn(options, 'setTimeout')
      ? requireFunction(ownDataValue(options, 'setTimeout', 'options'), 'options.setTimeout')
      : function () { return globalObject.setTimeout.apply(globalObject, arguments); };
    var cancelTimeout = Object.hasOwn(options, 'clearTimeout')
      ? requireFunction(ownDataValue(options, 'clearTimeout', 'options'), 'options.clearTimeout')
      : function () { return globalObject.clearTimeout.apply(globalObject, arguments); };
    var dimensions = readDimensions(target);

    var documentObject = target.ownerDocument;
    var writerHost = documentObject.createElementNS(HTML_NAMESPACE, 'div');
    var overlay = documentObject.createElementNS(SVG_NAMESPACE, 'svg');
    var errorLayer = documentObject.createElementNS(SVG_NAMESPACE, 'g');
    var dotLayer = documentObject.createElementNS(SVG_NAMESPACE, 'g');
    var startDot = documentObject.createElementNS(SVG_NAMESPACE, 'circle');
    setAttribute(writerHost, 'class', 'practice-writer-host');
    writerHost.style.position = 'absolute';
    writerHost.style.inset = '0';
    setAttribute(overlay, 'class', 'practice-overlay');
    setAttribute(overlay, 'aria-hidden', 'true');
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.pointerEvents = 'none';
    setAttribute(errorLayer, 'class', 'practice-error-layer');
    setAttribute(dotLayer, 'class', 'practice-start-dot-layer');
    setAttribute(startDot, 'class', 'practice-start-dot');
    setAttribute(startDot, 'r', '18');
    setAttribute(startDot, 'fill', BRAND_RED);
    setAttribute(startDot, 'visibility', 'hidden');
    dotLayer.appendChild(startDot);
    overlay.appendChild(errorLayer);
    overlay.appendChild(dotLayer);

    var originalPosition = target.style.position;
    var computedPosition = null;
    var defaultView = documentObject.defaultView;
    if (defaultView && typeof defaultView.getComputedStyle === 'function') {
      var computedStyle = defaultView.getComputedStyle(target);
      if (computedStyle && typeof computedStyle.position === 'string') {
        computedPosition = computedStyle.position;
      }
    }
    var changedPosition = computedPosition === null
      ? (!originalPosition || originalPosition === 'static')
      : computedPosition === 'static';
    var installedListenerTypes = [];
    var writerDocumentListeners = [];
    var writerHostInstalled = false;
    var overlayInstalled = false;
    var writer;
    var destroyed = false;
    var active = false;
    var phase = null;
    var currentStroke = 0;
    var revision = 0;
    var activePointerId = null;
    var errorTimer = null;
    var errorPath = null;
    var errorRevision = 0;
    var activationTasks = [];
    var activationRunning = false;

    function updateOverlaySize(nextDimensions) {
      setAttribute(overlay, 'width', nextDimensions.width);
      setAttribute(overlay, 'height', nextDimensions.height);
      setAttribute(overlay, 'viewBox', '0 0 ' + nextDimensions.width + ' ' + nextDimensions.height);
      var scaling = hanziApi.getScalingTransform.call(
        hanziApi.object, nextDimensions.width, nextDimensions.height, PADDING
      );
      if (!scaling || typeof scaling.transform !== 'string') {
        throw new TypeError('options.HanziWriter.getScalingTransform(): must return a transform string');
      }
      setAttribute(dotLayer, 'transform', scaling.transform);
    }

    function updateDot() {
      if (!active || currentStroke >= geometry.strokeCount) {
        setAttribute(startDot, 'visibility', 'hidden');
        return;
      }
      var point = geometry.medians[currentStroke][0];
      setAttribute(startDot, 'cx', point[0]);
      setAttribute(startDot, 'cy', point[1]);
      setAttribute(startDot, 'visibility', 'visible');
    }

    function clearError() {
      errorRevision += 1;
      if (errorTimer !== null) {
        cancelTimeout(errorTimer);
        errorTimer = null;
      }
      removeNode(errorPath);
      errorPath = null;
    }

    function renderError(pathString, ownerRevision) {
      clearError();
      var ownerErrorRevision = errorRevision;
      errorPath = documentObject.createElementNS(SVG_NAMESPACE, 'path');
      setAttribute(errorPath, 'class', 'practice-error-path');
      setAttribute(errorPath, 'd', pathString);
      setAttribute(errorPath, 'fill', 'none');
      setAttribute(errorPath, 'stroke', BRAND_RED);
      setAttribute(errorPath, 'stroke-linecap', 'round');
      setAttribute(errorPath, 'stroke-linejoin', 'round');
      setAttribute(errorPath, 'stroke-width', '4');
      errorLayer.appendChild(errorPath);
      if (reducedMotion) {
        clearError();
        return;
      }
      errorTimer = scheduleTimeout(function () {
        if (destroyed || revision !== ownerRevision || errorRevision !== ownerErrorRevision) return;
        errorTimer = null;
        removeNode(errorPath);
        errorPath = null;
      }, ERROR_DURATION);
    }

    function assertAlive() {
      if (destroyed) throw new Error('Practice engine has been destroyed');
    }

    function requireActive(command) {
      if (!active) throw new Error('Practice engine must be active to ' + command);
    }

    function emit(event) {
      try {
        onEvent(event);
      } catch (_error) {
        // Observer failures must not escape into Hanzi Writer callbacks.
      }
    }

    function ownsActivation(ownerRevision) {
      return !destroyed && active && revision === ownerRevision;
    }

    function safeCancelQuiz() {
      try {
        writer.cancelQuiz();
      } catch (_error) {
        // Cleanup continues even if the third-party writer rejects cancellation.
      }
    }

    function finishActivation() {
      activationRunning = false;
      drainActivations();
    }

    function settleOperation(result, onFulfilled, onRejected) {
      var then;
      try {
        then = result && result.then;
      } catch (_error) {
        onRejected();
        return;
      }
      if (typeof then !== 'function') {
        onFulfilled();
        return;
      }
      Promise.resolve(result).then(onFulfilled, onRejected);
    }

    function drainActivations() {
      if (activationRunning) return;
      while (activationTasks.length !== 0) {
        var task = activationTasks.shift();
        if (!ownsActivation(task.revision)) continue;
        activationRunning = true;
        var outlineResult;
        try {
          outlineResult = task.phase === 'guided'
            ? writer.showOutline({ duration: 0 })
            : writer.hideOutline({ duration: 0 });
        } catch (_error) {
          safeCancelQuiz();
          finishActivation();
          return;
        }
        settleOperation(outlineResult, function () {
          if (!ownsActivation(task.revision)) {
            safeCancelQuiz();
            finishActivation();
            return;
          }
          var quizResult;
          try {
            quizResult = writer.quiz(task.quizOptions);
          } catch (_error) {
            safeCancelQuiz();
            finishActivation();
            return;
          }
          settleOperation(quizResult, function () {
            if (!ownsActivation(task.revision)) safeCancelQuiz();
            finishActivation();
          }, function () {
            safeCancelQuiz();
            finishActivation();
          });
        }, function () {
          safeCancelQuiz();
          finishActivation();
        });
        return;
      }
    }

    function queueActivation(ownerRevision, ownerPhase, quizOptions) {
      activationTasks.push({ revision: ownerRevision, phase: ownerPhase, quizOptions: quizOptions });
      drainActivations();
    }

    function invalidateActiveQuiz() {
      revision += 1;
      activePointerId = null;
      if (active) safeCancelQuiz();
      active = false;
      clearError();
      updateDot();
    }

    function begin(nextPhase, nextStroke) {
      if (active) invalidateActiveQuiz();
      else {
        revision += 1;
        activePointerId = null;
        clearError();
      }
      phase = nextPhase;
      currentStroke = nextStroke;
      active = true;
      var ownerRevision = revision;
      updateDot();
      var quizOptions = {
        quizStartStrokeNum: currentStroke,
        showHintAfterMisses: 2,
        acceptBackwardsStrokes: false,
        leniency: LENIENCY,
        highlightOnComplete: false,
        onCorrectStroke: function (data) {
          if (destroyed || !active || revision !== ownerRevision) return;
          var event = normalizeStrokeEvent('stroke-correct', data, currentStroke);
          if (!event) return;
          currentStroke = event.strokeNum + 1;
          updateDot();
          emit(event);
        },
        onMistake: function (data) {
          if (destroyed || !active || revision !== ownerRevision) return;
          var event = normalizeStrokeEvent('stroke-mistake', data, currentStroke);
          if (!event) return;
          renderError(event.drawnPath.pathString, ownerRevision);
          emit(event);
        },
        onComplete: function (data) {
          if (destroyed || !active || revision !== ownerRevision) return;
          var event = normalizeCompleteEvent(data);
          if (!event) return;
          active = false;
          activePointerId = null;
          clearError();
          updateDot();
          emit(event);
        }
      };
      queueActivation(ownerRevision, phase, quizOptions);
    }

    function start(startOptions) {
      assertAlive();
      requireExactFields(startOptions, START_FIELDS, START_FIELDS, 'start options');
      var nextPhase = ownDataValue(startOptions, 'phase', 'start options');
      var nextStroke = ownDataValue(startOptions, 'strokeIndex', 'start options');
      if (nextPhase !== 'guided' && nextPhase !== 'independent') {
        reject('start options.phase', 'must equal guided or independent');
      }
      if (!Number.isSafeInteger(nextStroke) || nextStroke < 0 || nextStroke >= geometry.strokeCount) {
        reject('start options.strokeIndex', 'must be a safe integer within the character');
      }
      begin(nextPhase, nextStroke);
    }

    function restart() {
      assertAlive();
      requireActive('restart');
      begin(phase, 0);
    }

    function showHint() {
      assertAlive();
      requireActive('show a hint');
      if (currentStroke >= geometry.strokeCount) return;
      writer.highlightStroke(currentStroke);
    }

    function resize() {
      assertAlive();
      var nextDimensions = readDimensions(target);
      writer.updateDimensions({ width: nextDimensions.width, height: nextDimensions.height, padding: PADDING });
      dimensions = nextDimensions;
      updateOverlaySize(dimensions);
      updateDot();
    }

    function cancel() {
      assertAlive();
      if (!active) {
        revision += 1;
        activePointerId = null;
        clearError();
        updateDot();
        return;
      }
      invalidateActiveQuiz();
    }

    function restartInterruptedStroke() {
      if (destroyed || !active) return;
      var savedPhase = phase;
      var savedStroke = currentStroke;
      begin(savedPhase, savedStroke);
      activePointerId = null;
    }

    function onPointerDown(event) {
      if (destroyed || !active || !Number.isFinite(event.pointerId)) return;
      if (activePointerId === null) {
        if (event.isPrimary === false) return;
        activePointerId = event.pointerId;
      } else if (activePointerId !== event.pointerId) {
        restartInterruptedStroke();
      }
    }

    function onPointerUp(event) {
      if (destroyed || !active || event.pointerId !== activePointerId) return;
      activePointerId = null;
    }

    function onPointerAborted(event) {
      if (destroyed || !active || event.pointerId !== activePointerId) return;
      restartInterruptedStroke();
    }

    var listenerByType = {
      pointerdown: onPointerDown,
      pointerup: onPointerUp,
      pointercancel: onPointerAborted,
      lostpointercapture: onPointerAborted,
      pointerleave: onPointerAborted
    };

    function installListeners() {
      LISTENER_TYPES.forEach(function (type) {
        installedListenerTypes.push(type);
        target.addEventListener(type, listenerByType[type], true);
      });
    }

    function removeListeners() {
      while (installedListenerTypes.length !== 0) {
        var type = installedListenerTypes.pop();
        target.removeEventListener(type, listenerByType[type], true);
      }
    }

    function removeWriterDocumentListeners() {
      while (writerDocumentListeners.length !== 0) {
        var listener = writerDocumentListeners.pop();
        try {
          documentObject.removeEventListener(listener.type, listener.callback, listener.options);
        } catch (_error) {
          // Continue removing the remaining known writer listeners.
        }
      }
    }

    function restorePosition() {
      if (changedPosition && target.style.position === 'relative') {
        target.style.position = originalPosition;
      }
    }

    function createWriterWithCapturedDocumentListeners(createWriter) {
      var ownDescriptor;
      var originalAdd;
      try {
        ownDescriptor = Object.getOwnPropertyDescriptor(documentObject, 'addEventListener');
        originalAdd = documentObject.addEventListener;
      } catch (_error) {
        throw new Error('Hanzi Writer document listener capture could not be installed');
      }
      if (typeof originalAdd !== 'function'
          || typeof documentObject.removeEventListener !== 'function'
          || (ownDescriptor && ownDescriptor.configurable !== true)) {
        throw new Error('Hanzi Writer document listener capture could not be installed');
      }
      var capturedAdd = function (type, callback, listenerOptions) {
        writerDocumentListeners.push({
          type: type,
          callback: callback,
          options: listenerOptions
        });
        return originalAdd.call(documentObject, type, callback, listenerOptions);
      };
      try {
        Object.defineProperty(documentObject, 'addEventListener', {
          configurable: true,
          enumerable: ownDescriptor ? ownDescriptor.enumerable : false,
          writable: true,
          value: capturedAdd
        });
      } catch (_error) {
        throw new Error('Hanzi Writer document listener capture could not be installed');
      }
      if (documentObject.addEventListener !== capturedAdd) {
        throw new Error('Hanzi Writer document listener capture could not be installed');
      }

      var result;
      var creationError = null;
      try {
        result = createWriter();
      } catch (error) {
        creationError = error;
      }
      try {
        if (ownDescriptor) Object.defineProperty(documentObject, 'addEventListener', ownDescriptor);
        else delete documentObject.addEventListener;
      } catch (_error) {
        removeWriterDocumentListeners();
        throw new Error('Hanzi Writer document listener capture could not be restored');
      }
      if (documentObject.addEventListener !== originalAdd) {
        removeWriterDocumentListeners();
        throw new Error('Hanzi Writer document listener capture could not be restored');
      }
      if (creationError) throw creationError;
      return result;
    }

    function rollbackConstruction() {
      removeListeners();
      removeWriterDocumentListeners();
      if (overlayInstalled) removeNode(overlay);
      overlayInstalled = false;
      if (writerHostInstalled) removeNode(writerHost);
      writerHostInstalled = false;
      restorePosition();
    }

    try {
      if (changedPosition) target.style.position = 'relative';
      updateOverlaySize(dimensions);
      installListeners();
      target.appendChild(writerHost);
      writerHostInstalled = true;
      var writerOptions = {
        width: dimensions.width,
        height: dimensions.height,
        padding: PADDING,
        showCharacter: false,
        showOutline: true,
        drawingColor: '#1769aa',
        strokeColor: '#20252b',
        highlightColor: BRAND_RED,
        acceptBackwardsStrokes: false,
        leniency: LENIENCY,
        highlightOnComplete: false,
        charDataLoader: function () {
          return Object.freeze({
            strokes: Object.freeze(geometry.strokes.slice()),
            medians: Object.freeze(geometry.medians.map(function (median) {
              return Object.freeze(median.map(function (point) { return Object.freeze(point.slice()); }));
            }))
          });
        }
      };
      writer = createWriterWithCapturedDocumentListeners(function () {
        return hanziApi.create.call(hanziApi.object, writerHost, character, writerOptions);
      });
      ['quiz', 'cancelQuiz', 'highlightStroke', 'updateDimensions', 'showOutline', 'hideOutline']
        .forEach(function (method) { requirePublicFunction(writer, method, 'writer'); });
      target.appendChild(overlay);
      overlayInstalled = true;
    } catch (error) {
      rollbackConstruction();
      throw error;
    }

    function destroy() {
      if (destroyed) return;
      revision += 1;
      destroyed = true;
      active = false;
      activePointerId = null;
      activationTasks = [];
      safeCancelQuiz();
      clearError();
      removeListeners();
      removeWriterDocumentListeners();
      removeNode(overlay);
      overlayInstalled = false;
      removeNode(writerHost);
      writerHostInstalled = false;
      restorePosition();
    }

    return Object.freeze({
      start: start,
      restart: restart,
      showHint: showHint,
      resize: resize,
      cancel: cancel,
      destroy: destroy
    });
  }

  return Object.freeze({ createPracticeEngine: createPracticeEngine });
}));
