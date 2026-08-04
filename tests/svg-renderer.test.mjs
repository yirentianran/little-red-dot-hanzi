import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import svgRendererModule from '../js/svg-renderer.js';

const {
  clampProgress,
  createSvgRenderer,
  pointAtPolylineDistance,
  pointsToPath,
  polylineLength
} = svgRendererModule;

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.namespaceURI = tagName === 'div' ? null : SVG_NAMESPACE;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;

    if (tagName === 'path' && ownerDocument.metricsMode !== 'absent') {
      this.getTotalLength = () => {
        ownerDocument.totalLengthCalls.push(this);
        if (ownerDocument.metricsMode === 'throw') throw new Error('path metrics unavailable');
        return ownerDocument.metricLength;
      };
      this.getPointAtLength = (distance) => {
        ownerDocument.pointAtLengthCalls.push({ element: this, distance });
        if (ownerDocument.metricsMode === 'throw' || ownerDocument.metricsMode === 'point-throws') {
          throw new Error('path metrics unavailable');
        }
        return {
          x: distance + ownerDocument.pointOffset.x,
          y: distance + ownerDocument.pointOffset.y
        };
      };
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    if (!child || typeof child !== 'object') throw new TypeError('child must be an object');
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index === -1) throw new Error('child is not attached');
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  set innerHTML(_value) {
    throw new Error('renderer must not use innerHTML');
  }
}

class FakeSvgDocument {
  constructor(options = {}) {
    this.metricsMode = options.metricsMode || 'native';
    this.metricLength = options.metricLength ?? 100;
    this.pointOffset = options.pointOffset || { x: 10, y: 20 };
    this.created = [];
    this.totalLengthCalls = [];
    this.pointAtLengthCalls = [];
  }

  createElementNS(namespace, tagName) {
    assert.equal(namespace, SVG_NAMESPACE);
    const element = new FakeElement(tagName, this);
    this.created.push(element);
    return element;
  }
}

function createDom(options) {
  const document = new FakeSvgDocument(options);
  return {
    container: new FakeElement('div', document),
    document
  };
}

function fixtureGeometry(strokeCount = 3) {
  return {
    strokeCount,
    strokes: Array.from({ length: strokeCount }, (_unused, index) => (
      `M ${index} ${index} L ${index + 10} ${index + 10} Z`
    )),
    medians: Array.from({ length: strokeCount }, (_unused, index) => [
      [index, index],
      [index + 100, index]
    ])
  };
}

function descendants(root) {
  const result = [];
  function visit(element) {
    result.push(element);
    element.childNodes.forEach(visit);
  }
  visit(root);
  return result;
}

function withClass(root, className) {
  return descendants(root).filter((element) => (
    (element.getAttribute('class') || '').split(/\s+/).includes(className)
  ));
}

function withTag(root, tagName) {
  return descendants(root).filter((element) => element.tagName === tagName);
}

function assertDisplay(elements, expected) {
  assert.deepEqual(elements.map((element) => element.getAttribute('display')), expected);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test('converts median points to an SVG path without changing coordinates', () => {
  assert.equal(
    pointsToPath([[0, 0], [512, 512], [1024, 0]]),
    'M 0 0 L 512 512 L 1024 0'
  );
});

test('clamps finite visual progress to the inclusive unit interval', () => {
  assert.equal(clampProgress(-1), 0);
  assert.equal(clampProgress(0.4), 0.4);
  assert.equal(clampProgress(2), 1);
});

test('measures a multi-segment median polyline', () => {
  assert.equal(polylineLength([[0, 0], [3, 4], [6, 8]]), 10);
});

test('locates a point at a clamped distance along a median polyline', () => {
  const points = [[0, 0], [3, 4], [6, 4]];

  assert.deepEqual(pointAtPolylineDistance(points, -1), { x: 0, y: 0 });
  assert.deepEqual(pointAtPolylineDistance(points, 6), { x: 4, y: 4 });
  assert.deepEqual(pointAtPolylineDistance(points, 99), { x: 6, y: 4 });
});

test('builds an unflipped practice grid and flipped Hanzi geometry layers', () => {
  const { container, document } = createDom({ metricLength: 240 });
  const renderer = createSvgRenderer(container, fixtureGeometry(2));
  const [svg] = container.childNodes;
  const [grid] = withClass(svg, 'hanzi-grid');
  const [geometryLayer] = withClass(svg, 'hanzi-geometry');
  const clips = withTag(svg, 'clipPath');
  const ghosts = withClass(svg, 'hanzi-stroke--ghost');
  const completed = withClass(svg, 'hanzi-stroke--completed');
  const startCaps = withClass(svg, 'hanzi-stroke-start-cap');
  const reveals = withClass(svg, 'hanzi-stroke-reveal');
  const [outerDot] = withClass(svg, 'hanzi-tracking-dot--outer');
  const [coreDot] = withClass(svg, 'hanzi-tracking-dot--core');

  assert.equal(svg.tagName, 'svg');
  assert.equal(svg.namespaceURI, SVG_NAMESPACE);
  assert.equal(svg.getAttribute('viewBox'), '0 0 1024 1024');
  assert.equal(svg.getAttribute('preserveAspectRatio'), 'xMidYMid meet');
  assert.equal(grid.getAttribute('transform'), null);
  assert.equal(geometryLayer.getAttribute('transform'), 'translate(0 900) scale(1 -1)');
  assert.equal(withClass(grid, 'hanzi-grid__border').length, 1);
  assert.equal(withClass(grid, 'hanzi-grid__axis').length, 2);
  assert.equal(withClass(grid, 'hanzi-grid__diagonal').length, 2);
  withClass(grid, 'hanzi-grid__line').forEach((line) => {
    assert.equal(line.getAttribute('vector-effect'), 'non-scaling-stroke');
  });

  assert.equal(clips.length, 2);
  assert.equal(ghosts.length, 2);
  assert.equal(completed.length, 2);
  assert.equal(startCaps.length, 2);
  assert.equal(reveals.length, 2);
  assert.equal(ghosts[0].getAttribute('fill'), '#dce7ef');
  assert.equal(completed[0].getAttribute('fill'), '#20252b');
  assert.equal(startCaps[0].getAttribute('cx'), '0');
  assert.equal(startCaps[0].getAttribute('cy'), '0');
  assert.equal(startCaps[0].getAttribute('r'), '90');
  assert.equal(startCaps[0].getAttribute('fill'), '#20252b');
  assert.equal(startCaps[0].getAttribute('clip-path'), `url(#${clips[0].getAttribute('id')})`);
  assert.equal(startCaps[0].getAttribute('display'), 'none');
  assert.equal(reveals[0].getAttribute('stroke-width'), '180');
  assert.equal(reveals[0].getAttribute('stroke-linecap'), 'butt');
  assert.equal(reveals[0].getAttribute('stroke-linejoin'), 'round');
  assert.equal(reveals[0].getAttribute('stroke-dasharray'), '240');
  assert.equal(reveals[0].getAttribute('stroke-dashoffset'), '240');
  assert.equal(reveals[0].getAttribute('display'), 'none');
  assert.equal(completed[0].getAttribute('display'), 'none');
  assert.match(clips[0].getAttribute('id'), /^hanzi-stroke-clip-[a-z0-9-]+$/);
  assert.equal(reveals[0].getAttribute('clip-path'), `url(#${clips[0].getAttribute('id')})`);
  assert.equal(outerDot.parentNode, coreDot.parentNode);
  assert.equal(outerDot.parentNode.parentNode, geometryLayer);
  assert.equal(outerDot.getAttribute('fill'), '#e5483f');
  assert.equal(outerDot.getAttribute('opacity'), '0.24');
  assert.equal(coreDot.getAttribute('r'), '18');
  assert.equal(coreDot.getAttribute('fill'), '#d92d20');
  assert.equal(coreDot.getAttribute('stroke'), null);
  assert.equal(coreDot.getAttribute('stroke-width'), null);
  assert.equal(coreDot.getAttribute('display'), 'none');
  assert.equal(document.totalLengthCalls.length, 2);
  assert.ok(Object.isFrozen(renderer));
});

test('uses unique safe clip ids for multiple renderers', () => {
  const firstDom = createDom();
  const secondDom = createDom();
  createSvgRenderer(firstDom.container, fixtureGeometry(2));
  createSvgRenderer(secondDom.container, fixtureGeometry(2));

  const firstIds = withTag(firstDom.container, 'clipPath').map((clip) => clip.getAttribute('id'));
  const secondIds = withTag(secondDom.container, 'clipPath').map((clip) => clip.getAttribute('id'));
  const allIds = [...firstIds, ...secondIds];

  assert.equal(new Set(allIds).size, allIds.length);
  allIds.forEach((id) => assert.match(id, /^[a-z][a-z0-9-]*$/));
});

test('exposes exactly one stable core tracking dot hook per renderer', () => {
  const renderers = [createDom(), createDom()];

  renderers.forEach(({ container }) => {
    createSvgRenderer(container, fixtureGeometry(1));
    const [coreDot] = withClass(container, 'hanzi-tracking-dot--core');
    const [outerDot] = withClass(container, 'hanzi-tracking-dot--outer');
    const hookedDots = withTag(container, 'circle').filter((circle) => (
      circle.getAttribute('data-tracking-dot') === 'core'
    ));

    assert.equal(hookedDots.length, 1);
    assert.equal(hookedDots[0], coreDot);
    assert.equal(outerDot.getAttribute('data-tracking-dot'), null);
  });
});

test('reveals one clipped median, completes prior strokes, and tracks native path metrics', () => {
  const { container, document } = createDom({
    metricLength: 100,
    pointOffset: { x: 10, y: 20 }
  });
  const renderer = createSvgRenderer(container, fixtureGeometry(3));
  const [svg] = container.childNodes;
  const completed = withClass(svg, 'hanzi-stroke--completed');
  const startCaps = withClass(svg, 'hanzi-stroke-start-cap');
  const reveals = withClass(svg, 'hanzi-stroke-reveal');
  const [outerDot] = withClass(svg, 'hanzi-tracking-dot--outer');
  const [coreDot] = withClass(svg, 'hanzi-tracking-dot--core');
  const createdCount = document.created.length;

  renderer.setStrokeProgress(1, 0.25);

  assertDisplay(completed, ['inline', 'none', 'none']);
  assertDisplay(startCaps, ['none', 'inline', 'none']);
  assertDisplay(reveals, ['none', 'inline', 'none']);
  assert.equal(reveals[1].getAttribute('stroke-dashoffset'), '75');
  assert.equal(outerDot.getAttribute('display'), 'inline');
  assert.equal(coreDot.getAttribute('display'), 'inline');
  assert.equal(outerDot.getAttribute('cx'), '35');
  assert.equal(outerDot.getAttribute('cy'), '45');
  assert.equal(coreDot.getAttribute('cx'), '35');
  assert.equal(coreDot.getAttribute('cy'), '45');
  assert.equal(document.totalLengthCalls.length, 3);
  assert.equal(document.pointAtLengthCalls.length, 1);
  assert.equal(document.pointAtLengthCalls[0].element, reveals[1]);
  assert.equal(document.pointAtLengthCalls[0].distance, 25);
  assert.equal(document.created.length, createdCount);

  renderer.setStrokeProgress(1, -2);
  assert.equal(reveals[1].getAttribute('stroke-dashoffset'), '100');
  assert.equal(coreDot.getAttribute('cx'), '10');
  assert.equal(coreDot.getAttribute('cy'), '20');

  renderer.setStrokeProgress(1, 4);
  assert.equal(reveals[1].getAttribute('stroke-dashoffset'), '0');
  assert.equal(coreDot.getAttribute('cx'), '110');
  assert.equal(coreDot.getAttribute('cy'), '120');
});

test('falls back to polyline metrics when SVG path measurement is unavailable', () => {
  const { container } = createDom({ metricsMode: 'absent' });
  const geometry = {
    strokeCount: 1,
    strokes: ['M 0 0 L 6 4 Z'],
    medians: [[[0, 0], [3, 4], [6, 4]]]
  };
  const renderer = createSvgRenderer(container, geometry);
  const [svg] = container.childNodes;
  const [reveal] = withClass(svg, 'hanzi-stroke-reveal');
  const [coreDot] = withClass(svg, 'hanzi-tracking-dot--core');

  assert.equal(renderer.getStrokeLength(0), 8);
  assert.equal(reveal.getAttribute('stroke-dasharray'), '8');
  renderer.setStrokeProgress(0, 0.75);
  assert.equal(reveal.getAttribute('stroke-dashoffset'), '2');
  assert.equal(coreDot.getAttribute('cx'), '4');
  assert.equal(coreDot.getAttribute('cy'), '4');
});

test('rescales the polyline fallback when native point lookup throws', () => {
  const { container, document } = createDom({
    metricsMode: 'point-throws',
    metricLength: 80
  });
  const geometry = {
    strokeCount: 1,
    strokes: ['M 0 0 L 6 4 Z'],
    medians: [[[0, 0], [3, 4], [6, 4]]]
  };
  const renderer = createSvgRenderer(container, geometry);
  const [svg] = container.childNodes;
  const [reveal] = withClass(svg, 'hanzi-stroke-reveal');
  const [coreDot] = withClass(svg, 'hanzi-tracking-dot--core');

  renderer.setStrokeProgress(0, 0.75);

  assert.equal(renderer.getStrokeLength(0), 80);
  assert.equal(reveal.getAttribute('stroke-dashoffset'), '20');
  assert.equal(document.pointAtLengthCalls.length, 1);
  assert.equal(coreDot.getAttribute('cx'), '4');
  assert.equal(coreDot.getAttribute('cy'), '4');
});

test('switches completed and full-character states without rebuilding the SVG', () => {
  const { container, document } = createDom();
  const renderer = createSvgRenderer(container, fixtureGeometry(3));
  const [svg] = container.childNodes;
  const completed = withClass(svg, 'hanzi-stroke--completed');
  const startCaps = withClass(svg, 'hanzi-stroke-start-cap');
  const reveals = withClass(svg, 'hanzi-stroke-reveal');
  const dots = withClass(svg, 'hanzi-tracking-dot');
  const createdCount = document.created.length;

  renderer.setStrokeProgress(2, 0.5);
  renderer.showCompletedThrough(1);
  assertDisplay(completed, ['inline', 'inline', 'none']);
  assertDisplay(startCaps, ['none', 'none', 'none']);
  assertDisplay(reveals, ['none', 'none', 'none']);
  assertDisplay(dots, ['none', 'none']);

  renderer.showCompletedThrough(-1);
  assertDisplay(completed, ['none', 'none', 'none']);

  renderer.showFullCharacter();
  assertDisplay(completed, ['inline', 'inline', 'inline']);
  assertDisplay(startCaps, ['none', 'none', 'none']);
  assertDisplay(reveals, ['none', 'none', 'none']);
  assertDisplay(dots, ['none', 'none']);
  assert.equal(document.created.length, createdCount);
});

test('reports stroke metadata and rejects invalid state indexes or progress', () => {
  const { container } = createDom({ metricLength: 75 });
  const renderer = createSvgRenderer(container, fixtureGeometry(2));

  assert.equal(renderer.getStrokeCount(), 2);
  assert.equal(renderer.getStrokeLength(0), 75);
  assert.throws(() => renderer.setStrokeProgress(-1, 0), RangeError);
  assert.throws(() => renderer.setStrokeProgress(2, 0), RangeError);
  assert.throws(() => renderer.setStrokeProgress(0.5, 0), RangeError);
  assert.throws(() => renderer.setStrokeProgress(0, Number.NaN), TypeError);
  assert.throws(() => renderer.showCompletedThrough(-2), RangeError);
  assert.throws(() => renderer.showCompletedThrough(2), RangeError);
  assert.throws(() => renderer.showCompletedThrough(0.5), RangeError);
  assert.throws(() => renderer.getStrokeLength(-1), RangeError);
  assert.throws(() => renderer.getStrokeLength(2), RangeError);
});

test('validates the container, document, and complete geometry boundaries', () => {
  const valid = fixtureGeometry(1);
  const { container } = createDom();
  const makeContainer = () => createDom().container;

  assert.throws(() => createSvgRenderer(null, valid), /container.*object/i);
  assert.throws(() => createSvgRenderer({}, valid), /container\.appendChild/i);
  assert.throws(
    () => createSvgRenderer({ appendChild() {} }, valid),
    /container\.ownerDocument/i
  );
  assert.throws(
    () => createSvgRenderer({ appendChild() {}, ownerDocument: {} }, valid),
    /createElementNS/i
  );
  assert.throws(() => createSvgRenderer(container, null), /geometry.*object/i);
  assert.throws(() => createSvgRenderer(makeContainer(), []), /geometry.*object/i);
  assert.throws(() => createSvgRenderer(makeContainer(), {}), /geometry\.strokeCount/i);
  assert.throws(
    () => createSvgRenderer(makeContainer(), { ...valid, strokeCount: 0 }),
    /geometry\.strokeCount.*positive integer/i
  );
  assert.throws(
    () => createSvgRenderer(makeContainer(), { ...valid, strokeCount: 1.5 }),
    /geometry\.strokeCount.*positive integer/i
  );
  assert.throws(
    () => createSvgRenderer(makeContainer(), { ...valid, strokes: 'no' }),
    /geometry\.strokes.*array/i
  );
  assert.throws(
    () => createSvgRenderer(makeContainer(), { ...valid, medians: 'no' }),
    /geometry\.medians.*array/i
  );
  assert.throws(
    () => createSvgRenderer(makeContainer(), { ...valid, strokes: [] }),
    /geometry\.strokes.*strokeCount/i
  );
  assert.throws(
    () => createSvgRenderer(makeContainer(), { ...valid, medians: [] }),
    /geometry\.medians.*strokeCount/i
  );
  assert.throws(
    () => createSvgRenderer(makeContainer(), { ...valid, strokes: ['  '] }),
    /geometry\.strokes\[0\].*non-blank/i
  );
  assert.throws(
    () => createSvgRenderer(makeContainer(), { ...valid, medians: [[[0, 0]]] }),
    /geometry\.medians\[0\].*at least two/i
  );
  assert.throws(
    () => createSvgRenderer(makeContainer(), { ...valid, medians: [[[0, 0, 1], [1, 1]]] }),
    /geometry\.medians\[0\]\[0\].*exactly two/i
  );
  assert.throws(
    () => createSvgRenderer(makeContainer(), { ...valid, medians: [[[0, 0], [1, Infinity]]] }),
    /geometry\.medians\[0\]\[1\].*finite/i
  );
});

test('destroy is idempotent and all later operations fail consistently', () => {
  const { container } = createDom();
  const renderer = createSvgRenderer(container, fixtureGeometry(1));

  renderer.destroy();
  renderer.destroy();
  assert.equal(container.childNodes.length, 0);

  const operations = [
    () => renderer.setStrokeProgress(0, 0),
    () => renderer.showCompletedThrough(-1),
    () => renderer.showFullCharacter(),
    () => renderer.getStrokeLength(0),
    () => renderer.getStrokeCount()
  ];
  operations.forEach((operation) => {
    assert.throws(operation, /renderer has been destroyed/i);
  });
});

test('classic loading merges the API without reading document or fetch', async () => {
  const source = await readFile(new URL('../js/svg-renderer.js', import.meta.url), 'utf8');
  const sandbox = { window: { HanziApp: { existing: true } } };
  Object.defineProperty(sandbox, 'document', {
    get() { throw new Error('document accessed at module load'); }
  });
  Object.defineProperty(sandbox, 'fetch', {
    get() { throw new Error('fetch accessed at module load'); }
  });

  vm.runInNewContext(source, sandbox, { filename: 'js/svg-renderer.js' });

  assert.equal(sandbox.window.HanziApp.existing, true);
  assert.equal(typeof sandbox.window.HanziApp.createSvgRenderer, 'function');
  assert.equal(typeof sandbox.window.HanziApp.clampProgress, 'function');
});

test('renders all strokes from the real frozen 宵 geometry without mutation', async () => {
  const source = JSON.parse(await readFile(new URL('../data/characters.json', import.meta.url), 'utf8'));
  const geometry = deepFreeze(source.characters['宵']);
  const snapshot = JSON.stringify(geometry);
  const { container } = createDom({ metricsMode: 'absent' });
  const renderer = createSvgRenderer(container, geometry);
  const [svg] = container.childNodes;

  assert.equal(geometry.strokeCount, 10);
  assert.equal(renderer.getStrokeCount(), 10);
  assert.equal(withClass(svg, 'hanzi-stroke--ghost').length, 10);
  assert.equal(withClass(svg, 'hanzi-stroke--completed').length, 10);
  assert.equal(withClass(svg, 'hanzi-stroke-start-cap').length, 10);
  assert.equal(withClass(svg, 'hanzi-stroke-reveal').length, 10);
  assert.equal(JSON.stringify(geometry), snapshot);
});
