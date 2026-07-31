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
  var rendererSerial = 0;

  function clampProgress(progress) {
    if (typeof progress !== 'number' || Number.isNaN(progress)) {
      throw new TypeError('progress must be a number');
    }
    return Math.min(1, Math.max(0, progress));
  }

  function pointsToPath(points) {
    return points.map(function (point, index) {
      return (index === 0 ? 'M ' : 'L ') + point[0] + ' ' + point[1];
    }).join(' ');
  }

  function polylineLength(points) {
    var length = 0;
    for (var index = 1; index < points.length; index += 1) {
      var deltaX = points[index][0] - points[index - 1][0];
      var deltaY = points[index][1] - points[index - 1][1];
      length += Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
    }
    return length;
  }

  function pointAtPolylineDistance(points, distance) {
    if (!Array.isArray(points) || points.length === 0) {
      throw new TypeError('points must be a non-empty array');
    }
    var totalLength = polylineLength(points);
    var target = Math.min(totalLength, Math.max(0, distance));
    if (target === 0 || totalLength === 0) {
      return { x: points[0][0], y: points[0][1] };
    }

    var traversed = 0;
    for (var index = 1; index < points.length; index += 1) {
      var start = points[index - 1];
      var end = points[index];
      var deltaX = end[0] - start[0];
      var deltaY = end[1] - start[1];
      var segmentLength = Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
      if (segmentLength > 0 && target <= traversed + segmentLength) {
        var ratio = (target - traversed) / segmentLength;
        return {
          x: start[0] + (deltaX * ratio),
          y: start[1] + (deltaY * ratio)
        };
      }
      traversed += segmentLength;
    }

    var last = points[points.length - 1];
    return { x: last[0], y: last[1] };
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function reject(path, requirement) {
    throw new TypeError(path + ': ' + requirement);
  }

  function requireOwn(record, field, path) {
    if (!Object.hasOwn(record, field)) reject(path + '.' + field, 'must be an own property');
    return record[field];
  }

  function validateContainer(container) {
    if (!isRecord(container)) reject('container', 'must be an object');
    if (typeof container.appendChild !== 'function') {
      reject('container.appendChild', 'must be a function');
    }
    if (!isRecord(container.ownerDocument)) {
      reject('container.ownerDocument', 'must be an object');
    }
    if (typeof container.ownerDocument.createElementNS !== 'function') {
      reject('container.ownerDocument.createElementNS', 'must be a function');
    }
    if (typeof container.removeChild !== 'function') {
      reject('container.removeChild', 'must be a function');
    }
    return container.ownerDocument;
  }

  function validateGeometry(geometry) {
    if (!isRecord(geometry)) reject('geometry', 'must be an object');
    var strokeCount = requireOwn(geometry, 'strokeCount', 'geometry');
    var strokes = requireOwn(geometry, 'strokes', 'geometry');
    var medians = requireOwn(geometry, 'medians', 'geometry');

    if (!Number.isInteger(strokeCount) || strokeCount <= 0) {
      reject('geometry.strokeCount', 'must be a positive integer');
    }
    if (!Array.isArray(strokes)) reject('geometry.strokes', 'must be an array');
    if (!Array.isArray(medians)) reject('geometry.medians', 'must be an array');
    if (strokes.length !== strokeCount) {
      reject('geometry.strokes', 'length must equal geometry.strokeCount');
    }
    if (medians.length !== strokeCount) {
      reject('geometry.medians', 'length must equal geometry.strokeCount');
    }

    for (var strokeIndex = 0; strokeIndex < strokeCount; strokeIndex += 1) {
      var stroke = strokes[strokeIndex];
      var strokePath = 'geometry.strokes[' + strokeIndex + ']';
      if (typeof stroke !== 'string' || stroke.trim() === '') {
        reject(strokePath, 'must be a non-blank string');
      }

      var median = medians[strokeIndex];
      var medianPath = 'geometry.medians[' + strokeIndex + ']';
      if (!Array.isArray(median) || median.length < 2) {
        reject(medianPath, 'must contain at least two points');
      }
      for (var pointIndex = 0; pointIndex < median.length; pointIndex += 1) {
        var point = median[pointIndex];
        var pointPath = medianPath + '[' + pointIndex + ']';
        if (!Array.isArray(point) || point.length !== 2) {
          reject(pointPath, 'must contain exactly two coordinates');
        }
        if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
          reject(pointPath, 'coordinates must be finite numbers');
        }
      }
    }
  }

  function createElement(documentObject, tagName, attributes) {
    var element = documentObject.createElementNS(SVG_NAMESPACE, tagName);
    if (!isRecord(element) || typeof element.setAttribute !== 'function'
        || typeof element.appendChild !== 'function') {
      reject(
        'container.ownerDocument.createElementNS',
        'must return SVG elements with setAttribute and appendChild'
      );
    }
    Object.keys(attributes || {}).forEach(function (name) {
      element.setAttribute(name, attributes[name]);
    });
    return element;
  }

  function appendLine(documentObject, parent, className, attributes) {
    var lineAttributes = Object.assign({
      'class': 'hanzi-grid__line ' + className,
      'stroke': '#b9c8d3',
      'stroke-width': 2,
      'vector-effect': 'non-scaling-stroke'
    }, attributes);
    parent.appendChild(createElement(documentObject, 'line', lineAttributes));
  }

  function buildGrid(documentObject) {
    var grid = createElement(documentObject, 'g', { 'class': 'hanzi-grid' });
    grid.appendChild(createElement(documentObject, 'rect', {
      'class': 'hanzi-grid__line hanzi-grid__border',
      'x': 12,
      'y': 12,
      'width': 1000,
      'height': 1000,
      'fill': 'none',
      'stroke': '#9fb2c0',
      'stroke-width': 3,
      'vector-effect': 'non-scaling-stroke'
    }));
    appendLine(documentObject, grid, 'hanzi-grid__axis', {
      'x1': 12, 'y1': 512, 'x2': 1012, 'y2': 512
    });
    appendLine(documentObject, grid, 'hanzi-grid__axis', {
      'x1': 512, 'y1': 12, 'x2': 512, 'y2': 1012
    });
    appendLine(documentObject, grid, 'hanzi-grid__diagonal', {
      'x1': 12, 'y1': 12, 'x2': 1012, 'y2': 1012, 'stroke-dasharray': '18 18'
    });
    appendLine(documentObject, grid, 'hanzi-grid__diagonal', {
      'x1': 1012, 'y1': 12, 'x2': 12, 'y2': 1012, 'stroke-dasharray': '18 18'
    });
    return grid;
  }

  function setDisplay(element, visible) {
    element.setAttribute('display', visible ? 'inline' : 'none');
  }

  function createSvgRenderer(container, geometry) {
    var documentObject = validateContainer(container);
    validateGeometry(geometry);
    rendererSerial += 1;
    var instanceId = 'r' + rendererSerial.toString(36);
    var destroyed = false;

    var svg = createElement(documentObject, 'svg', {
      'class': 'hanzi-character-svg',
      'viewBox': '0 0 1024 1024',
      'preserveAspectRatio': 'xMidYMid meet',
      'focusable': 'false'
    });
    svg.appendChild(buildGrid(documentObject));

    var geometryLayer = createElement(documentObject, 'g', {
      'class': 'hanzi-geometry',
      'transform': 'translate(0 900) scale(1 -1)'
    });
    var definitions = createElement(documentObject, 'defs', {});
    var ghostLayer = createElement(documentObject, 'g', { 'class': 'hanzi-strokes hanzi-strokes--ghost' });
    var completedLayer = createElement(documentObject, 'g', {
      'class': 'hanzi-strokes hanzi-strokes--completed'
    });
    var revealLayer = createElement(documentObject, 'g', { 'class': 'hanzi-reveals' });
    var dotLayer = createElement(documentObject, 'g', { 'class': 'hanzi-tracking-dots' });
    var completedPaths = [];
    var revealPaths = [];
    var strokeMetrics = [];

    for (var strokeIndex = 0; strokeIndex < geometry.strokeCount; strokeIndex += 1) {
      var clipId = 'hanzi-stroke-clip-' + instanceId + '-' + strokeIndex.toString(36);
      var clip = createElement(documentObject, 'clipPath', {
        'id': clipId,
        'clipPathUnits': 'userSpaceOnUse'
      });
      clip.appendChild(createElement(documentObject, 'path', {
        'd': geometry.strokes[strokeIndex],
        'fill': '#ffffff'
      }));
      definitions.appendChild(clip);

      var ghostPath = createElement(documentObject, 'path', {
        'class': 'hanzi-stroke hanzi-stroke--ghost',
        'd': geometry.strokes[strokeIndex],
        'fill': '#dce7ef',
        'stroke': 'none'
      });
      var completedPath = createElement(documentObject, 'path', {
        'class': 'hanzi-stroke hanzi-stroke--completed',
        'd': geometry.strokes[strokeIndex],
        'fill': '#20252b',
        'stroke': 'none',
        'display': 'none'
      });
      var revealPath = createElement(documentObject, 'path', {
        'class': 'hanzi-stroke-reveal',
        'd': pointsToPath(geometry.medians[strokeIndex]),
        'fill': 'none',
        'stroke': '#20252b',
        'stroke-width': 180,
        'stroke-linecap': 'butt',
        'stroke-linejoin': 'round',
        'clip-path': 'url(#' + clipId + ')',
        'display': 'none'
      });
      ghostLayer.appendChild(ghostPath);
      completedLayer.appendChild(completedPath);
      revealLayer.appendChild(revealPath);
      completedPaths.push(completedPath);
      revealPaths.push(revealPath);
    }

    var outerDot = createElement(documentObject, 'circle', {
      'class': 'hanzi-tracking-dot hanzi-tracking-dot--outer',
      'r': 24,
      'fill': '#e5483f',
      'opacity': 0.24,
      'display': 'none'
    });
    var coreDot = createElement(documentObject, 'circle', {
      'class': 'hanzi-tracking-dot hanzi-tracking-dot--core',
      'data-tracking-dot': 'core',
      'r': 18,
      'fill': '#d92d20',
      'display': 'none'
    });
    dotLayer.appendChild(outerDot);
    dotLayer.appendChild(coreDot);

    geometryLayer.appendChild(definitions);
    geometryLayer.appendChild(ghostLayer);
    geometryLayer.appendChild(completedLayer);
    geometryLayer.appendChild(revealLayer);
    geometryLayer.appendChild(dotLayer);
    svg.appendChild(geometryLayer);
    container.appendChild(svg);

    for (var metricIndex = 0; metricIndex < geometry.strokeCount; metricIndex += 1) {
      var reveal = revealPaths[metricIndex];
      var fallbackLength = polylineLength(geometry.medians[metricIndex]);
      var measuredLength = fallbackLength;
      var nativePoint = false;
      if (typeof reveal.getTotalLength === 'function') {
        try {
          var candidateLength = reveal.getTotalLength();
          if (Number.isFinite(candidateLength) && candidateLength >= 0) {
            measuredLength = candidateLength;
            nativePoint = typeof reveal.getPointAtLength === 'function';
          }
        } catch (_error) {
          measuredLength = fallbackLength;
        }
      }
      reveal.setAttribute('stroke-dasharray', measuredLength);
      reveal.setAttribute('stroke-dashoffset', measuredLength);
      strokeMetrics.push({
        length: measuredLength,
        fallbackLength: fallbackLength,
        median: geometry.medians[metricIndex],
        nativePoint: nativePoint
      });
    }

    function assertAlive() {
      if (destroyed) throw new Error('SVG renderer has been destroyed');
    }

    function requireStrokeIndex(index) {
      if (!Number.isInteger(index) || index < 0 || index >= geometry.strokeCount) {
        throw new RangeError('stroke index must be an integer from 0 to ' + (geometry.strokeCount - 1));
      }
    }

    function hideRevealsAndDots() {
      for (var index = 0; index < revealPaths.length; index += 1) {
        setDisplay(revealPaths[index], false);
        revealPaths[index].setAttribute('stroke-dashoffset', strokeMetrics[index].length);
      }
      setDisplay(outerDot, false);
      setDisplay(coreDot, false);
    }

    function locatePoint(index, distance, progress) {
      var reveal = revealPaths[index];
      var metric = strokeMetrics[index];
      if (metric.nativePoint) {
        try {
          var point = reveal.getPointAtLength(distance);
          if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
            return { x: point.x, y: point.y };
          }
        } catch (_error) {
          // Fall through when a browser cannot measure a hidden or detached path.
        }
      }
      return pointAtPolylineDistance(metric.median, metric.fallbackLength * progress);
    }

    function setStrokeProgress(index, progress) {
      assertAlive();
      requireStrokeIndex(index);
      var visualProgress = clampProgress(progress);

      for (var completedIndex = 0; completedIndex < completedPaths.length; completedIndex += 1) {
        setDisplay(completedPaths[completedIndex], completedIndex < index);
      }
      hideRevealsAndDots();

      var metric = strokeMetrics[index];
      var distance = metric.length * visualProgress;
      revealPaths[index].setAttribute('stroke-dashoffset', metric.length - distance);
      setDisplay(revealPaths[index], true);
      var point = locatePoint(index, distance, visualProgress);
      outerDot.setAttribute('cx', point.x);
      outerDot.setAttribute('cy', point.y);
      coreDot.setAttribute('cx', point.x);
      coreDot.setAttribute('cy', point.y);
      setDisplay(outerDot, true);
      setDisplay(coreDot, true);
    }

    function showCompletedThrough(index) {
      assertAlive();
      if (!Number.isInteger(index) || index < -1 || index >= geometry.strokeCount) {
        throw new RangeError(
          'completed stroke index must be an integer from -1 to ' + (geometry.strokeCount - 1)
        );
      }
      for (var completedIndex = 0; completedIndex < completedPaths.length; completedIndex += 1) {
        setDisplay(completedPaths[completedIndex], completedIndex <= index);
      }
      hideRevealsAndDots();
    }

    function showFullCharacter() {
      assertAlive();
      showCompletedThrough(geometry.strokeCount - 1);
    }

    function getStrokeLength(index) {
      assertAlive();
      requireStrokeIndex(index);
      return strokeMetrics[index].length;
    }

    function getStrokeCount() {
      assertAlive();
      return geometry.strokeCount;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (svg.parentNode) svg.parentNode.removeChild(svg);
    }

    return Object.freeze({
      setStrokeProgress: setStrokeProgress,
      showCompletedThrough: showCompletedThrough,
      showFullCharacter: showFullCharacter,
      getStrokeLength: getStrokeLength,
      getStrokeCount: getStrokeCount,
      destroy: destroy
    });
  }

  return Object.freeze({
    clampProgress: clampProgress,
    createSvgRenderer: createSvgRenderer,
    pointAtPolylineDistance: pointAtPolylineDistance,
    pointsToPath: pointsToPath,
    polylineLength: polylineLength
  });
}));
