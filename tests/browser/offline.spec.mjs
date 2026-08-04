import assert from 'node:assert/strict';
import path from 'node:path';

const VIEWPORTS = Object.freeze([
  Object.freeze({ width: 360, height: 800, label: '360x800' }),
  Object.freeze({ width: 768, height: 1024, label: '768x1024' }),
  Object.freeze({ width: 1440, height: 900, label: '1440x900' })
]);
const IPAD_AIR_LANDSCAPE_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1024, height: 768, label: 'iPad-Air-1024x768' }),
  Object.freeze({ width: 1180, height: 820, label: 'iPad-Air-1180x820' })
]);
const MATEPAD_LANDSCAPE_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1000, height: 607, label: 'MatePad-effective-1000x607' }),
  Object.freeze({ width: 1280, height: 601, label: 'MatePad-1280x601' }),
  Object.freeze({ width: 1280, height: 700, label: 'MatePad-1280x700' }),
  Object.freeze({ width: 1280, height: 760, label: 'MatePad-1280x760' })
]);
const COMPACT_TABLET_LANDSCAPE_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1024, height: 600, label: 'Android-tablet-1024x600' }),
  ...MATEPAD_LANDSCAPE_VIEWPORTS
]);
const ANDROID_TABLET_LANDSCAPE_VIEWPORTS = Object.freeze([
  ...COMPACT_TABLET_LANDSCAPE_VIEWPORTS,
  Object.freeze({ width: 1280, height: 800, label: 'Android-tablet-1280x800' })
]);
const PHONE_LANDSCAPE_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 568, height: 320, label: 'phone-568x320' }),
  Object.freeze({ width: 667, height: 375, label: 'phone-667x375' }),
  Object.freeze({ width: 844, height: 390, label: 'phone-844x390' }),
  Object.freeze({ width: 844, height: 320, label: 'Magic-7-844x320' }),
  Object.freeze({ width: 844, height: 360, label: 'Magic-7-844x360' }),
  Object.freeze({ width: 915, height: 320, label: 'wide-phone-915x320' }),
  Object.freeze({ width: 844, height: 300, label: 'Magic-7-844x300' }),
  Object.freeze({ width: 915, height: 300, label: 'wide-phone-915x300' })
]);
const PHONE_TOOL_BOUNDARY_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 959, height: 607, label: 'phone-tools-959x607' }),
  Object.freeze({ width: 960, height: 607, label: 'tablet-tools-960x607' })
]);
const COMPACT_LESSON_LANDSCAPE_VIEWPORTS = Object.freeze([
  ...COMPACT_TABLET_LANDSCAPE_VIEWPORTS,
  ...PHONE_LANDSCAPE_VIEWPORTS
]);
const PRACTICE_STATE_VIEWPORTS = Object.freeze([
  VIEWPORTS[2],
  MATEPAD_LANDSCAPE_VIEWPORTS[0],
  PHONE_LANDSCAPE_VIEWPORTS[3]
]);
const PAGE_STYLE_PARITY_VIEWPORTS = Object.freeze([
  VIEWPORTS[2],
  MATEPAD_LANDSCAPE_VIEWPORTS[0],
  PHONE_LANDSCAPE_VIEWPORTS[3]
]);
const LANDSCAPE_VIEWPORTS = Object.freeze([
  ...IPAD_AIR_LANDSCAPE_VIEWPORTS,
  ...ANDROID_TABLET_LANDSCAPE_VIEWPORTS,
  ...PHONE_LANDSCAPE_VIEWPORTS,
  Object.freeze({ width: 1440, height: 900, label: 'Mac-Chrome-1440x900' }),
  Object.freeze({ width: 1440, height: 800, label: 'Mac-Chrome-1440x800' })
]);

const PRACTICE_CHARACTER = '砂';
const PRACTICE_PADDING = 0;

function lessonHash(lessonId, group) {
  return `#/lesson?${new URLSearchParams({ lesson: lessonId, group })}`;
}

function characterHash(lessonId, group, character) {
  return `#/character?${new URLSearchParams({ lesson: lessonId, group, character })}`;
}

function practiceHash(lessonId, group, scope, character) {
  return `#/practice?${new URLSearchParams({ lesson: lessonId, group, scope, character })}`;
}

function withHash(indexUrl, hash) {
  const url = new URL(indexUrl);
  url.hash = hash;
  return url.href;
}

async function waitForView(page, view) {
  await page.locator(`[data-view="${view}"]`).waitFor({ state: 'visible' });
}

async function waitForPractice(page, phase) {
  await waitForView(page, 'practice');
  await page.locator('[data-view-heading]').filter({ hasText: `练习“${PRACTICE_CHARACTER}”` }).waitFor();
  if (phase) await page.locator('.practice-phase').filter({ hasText: phase }).waitFor();
  await page.locator('[data-slot="practice-board"] .practice-writer-host svg').waitFor();
  await page.locator('[data-slot="practice-board"][aria-busy="false"]').waitFor();
}

async function mappedPracticeMedian(page, strokeIndex, options = {}) {
  const { reverse = false, offsetX = 0, offsetY = 0 } = options;
  const points = await page.evaluate(({ character, index, padding }) => {
    const board = document.querySelector('[data-slot="practice-board"] .practice-writer-host');
    const geometry = window.HANZI_LIBRARY.characters[character];
    if (!board || !geometry) throw new Error(`missing practice geometry for ${character}`);
    const box = board.getBoundingClientRect();
    const transform = window.HanziWriter.getScalingTransform(box.width, box.height, padding);
    return geometry.medians[index].map(([x, y]) => ({
      x: box.left + transform.x + (x * transform.scale),
      y: box.top + box.height - transform.y - (y * transform.scale)
    }));
  }, { character: PRACTICE_CHARACTER, index: strokeIndex, padding: PRACTICE_PADDING });
  const mapped = points.map((point) => ({
    x: point.x + offsetX,
    y: point.y + offsetY
  }));
  if (reverse) mapped.reverse();
  return mapped;
}

async function drawPracticePoints(page, points) {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 3 });
  }
  await page.mouse.up();
}

async function drawPracticeMedian(page, strokeIndex, options) {
  await drawPracticePoints(page, await mappedPracticeMedian(page, strokeIndex, options));
}

async function waitForPracticeStroke(page, current, total) {
  await page.locator('[data-slot="practice-stroke-position"]')
    .filter({ hasText: `第 ${current} / ${total} 笔` }).waitFor();
}

async function drawPracticeCharacter(page) {
  const strokeCount = await page.evaluate((character) => (
    window.HANZI_LIBRARY.characters[character].strokeCount
  ), PRACTICE_CHARACTER);
  for (let index = 0; index < strokeCount; index += 1) {
    await drawPracticeMedian(page, index);
    if (index + 1 < strokeCount) await waitForPracticeStroke(page, index + 2, strokeCount);
  }
  return strokeCount;
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  assert.ok(
    dimensions.bodyScrollWidth <= dimensions.viewportWidth + 1,
    `${label}: body overflows horizontally: ${JSON.stringify(dimensions)}`
  );
  assert.ok(
    dimensions.documentScrollWidth <= dimensions.documentClientWidth + 1,
    `${label}: document overflows horizontally: ${JSON.stringify(dimensions)}`
  );
}

async function assertVisibleTargetsAreLargeEnough(page, label) {
  const undersized = await page.locator('button, a').evaluateAll((targets) => targets.flatMap((target) => {
    const style = getComputedStyle(target);
    const box = target.getBoundingClientRect();
    const rendered = style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.visibility !== 'collapse'
      && Number(style.opacity) !== 0
      && box.width > 0
      && box.height > 0;
    if (!rendered || (box.width >= 44 && box.height >= 44)) return [];
    return [{
      label: target.getAttribute('aria-label') || target.textContent.trim(),
      tag: target.tagName,
      width: box.width,
      height: box.height
    }];
  }));
  assert.deepEqual(undersized, [], `${label}: undersized targets ${JSON.stringify(undersized)}`);
}

function intersects(first, second, tolerance = 0.5) {
  const overlapWidth = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const overlapHeight = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  return overlapWidth > tolerance && overlapHeight > tolerance;
}

async function assertSelectorsDoNotOverlap(page, selectors, label) {
  const rectangles = await page.evaluate((requestedSelectors) => requestedSelectors.flatMap((selector) => {
    const element = document.querySelector(selector);
    if (!element) return [{ selector, missing: true }];
    const box = element.getBoundingClientRect();
    return [{
      selector,
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      height: box.height
    }];
  }), selectors);
  const missing = rectangles.filter((box) => box.missing);
  assert.deepEqual(missing, [], `${label}: missing critical element ${JSON.stringify(missing)}`);
  for (let firstIndex = 0; firstIndex < rectangles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < rectangles.length; secondIndex += 1) {
      const first = rectangles[firstIndex];
      const second = rectangles[secondIndex];
      assert.equal(
        intersects(first, second),
        false,
        `${label}: ${first.selector} overlaps ${second.selector}: ${JSON.stringify({ first, second })}`
      );
    }
  }
}

async function saveFullPageScreenshot(page, destination, label) {
  assert.equal(path.isAbsolute(destination), true, `${label}: artifact path must be absolute`);
  const png = await page.screenshot({ path: destination, fullPage: true });
  assert.ok(png.length > 4_000, `${label}: screenshot is unexpectedly small (${png.length} bytes)`);
  assert.deepEqual(
    Array.from(png.subarray(0, 8)),
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${label}: screenshot is not a PNG`
  );
  const pixels = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    try {
      const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      const histogram = new Map();
      let darkest = 255;
      let lightest = 0;
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const luminance = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
        darkest = Math.min(darkest, luminance);
        lightest = Math.max(lightest, luminance);
        const bucket = `${red >> 4},${green >> 4},${blue >> 4}`;
        histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
      }
      const sampleCount = width * height;
      const dominantCount = Math.max(...histogram.values());
      return {
        colorBuckets: histogram.size,
        luminanceRange: lightest - darkest,
        nonDominantRatio: (sampleCount - dominantCount) / sampleCount,
        sampleCount
      };
    } finally {
      bitmap.close();
    }
  }, png.toString('base64'));
  assert.ok(pixels.colorBuckets >= 8, `${label}: insufficient color variance ${JSON.stringify(pixels)}`);
  assert.ok(pixels.luminanceRange >= 40, `${label}: insufficient contrast ${JSON.stringify(pixels)}`);
  assert.ok(
    pixels.nonDominantRatio >= 0.05,
    `${label}: screenshot is nearly a single color ${JSON.stringify(pixels)}`
  );
}

async function analyzePracticeBoardRaster(page, board) {
  const png = await board.screenshot();
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  return page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const inset = Math.max(4, Math.round(Math.min(bitmap.width, bitmap.height) * 0.01));
      let inkPixels = 0;
      let redPixels = 0;
      for (let y = inset; y < bitmap.height - inset; y += 1) {
        for (let x = inset; x < bitmap.width - inset; x += 1) {
          const index = ((y * bitmap.width) + x) * 4;
          const red = data[index];
          const green = data[index + 1];
          const blue = data[index + 2];
          if (red < 245 || green < 245 || blue < 245) inkPixels += 1;
          if (red >= 150 && red > green * 1.4 && red > blue * 1.3) redPixels += 1;
        }
      }
      return { width: bitmap.width, height: bitmap.height, inkPixels, redPixels };
    } finally {
      bitmap.close();
    }
  }, png.toString('base64'));
}

async function observeScrollPosition(page, durationMs = 250) {
  return page.evaluate((duration) => new Promise((resolve) => {
    const samples = [];
    const deadline = performance.now() + duration;
    function sample() {
      samples.push(window.scrollY);
      if (performance.now() >= deadline) resolve(samples);
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }), durationMs);
}

async function assertDirectoryGeometry(page, label) {
  assert.equal(await page.locator('[data-view-heading]').textContent(), '阶段目录');
  assert.equal(await page.locator(
    '[data-action="open-lesson"][data-lesson-id="g4f-02"]'
  ).count(), 1);
  await assertSelectorsDoNotOverlap(page, [
    '[data-view="directory"] [data-view-heading]',
    '[data-view="directory"] [data-unit-band="g4-fall"]'
  ], label);
}

async function assertLessonGeometry(page, label) {
  assert.equal(await page.locator('[data-view-heading]').textContent(), '第2组');
  assert.equal(
    await page.locator('[data-action="select-group"][data-group="write"]')
      .getAttribute('aria-pressed'),
    'true'
  );
  assert.equal(await page.locator(
    '[data-action="open-character"][data-character="砂"]'
  ).count(), 2);
  await assertSelectorsDoNotOverlap(page, [
    '[data-view="lesson"] [data-action="go-directory"]',
    '[data-view="lesson"] .view-eyebrow',
    '[data-view="lesson"] [data-view-heading]',
    '[data-view="lesson"] .segmented-control',
    '[data-view="lesson"] .lesson-start',
    '[data-view="lesson"] .character-grid'
  ], label);
}

async function assertCharacterGeometry(page, viewport, label) {
  assert.equal(await page.locator('[data-view-heading]').textContent(), '学习“砂”');
  assert.equal(await page.locator('.character-pinyin').textContent(), 'shā');
  assert.match(await page.locator('[data-action="back-lesson"]').textContent(), /第2组/);

  const board = page.locator('[data-slot="character-board"]');
  const before = await board.boundingBox();
  assert.ok(before, `${label}: board has no bounding box`);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => (
    requestAnimationFrame(resolve)
  ))));
  await page.waitForTimeout(120);
  const after = await board.boundingBox();
  assert.ok(after, `${label}: board disappeared`);
  assert.ok(Math.abs(before.width - before.height) <= 1.5, `${label}: board is not square ${JSON.stringify(before)}`);
  assert.ok(Math.abs(after.width - after.height) <= 1.5, `${label}: board stopped being square ${JSON.stringify(after)}`);
  assert.ok(
    Math.abs(before.width - after.width) <= 1 && Math.abs(before.height - after.height) <= 1,
    `${label}: board size shifted ${JSON.stringify({ before, after })}`
  );

  const layout = await page.evaluate(() => {
    function box(selector) {
      const rectangle = document.querySelector(selector).getBoundingClientRect();
      return {
        left: rectangle.left,
        right: rectangle.right,
        top: rectangle.top,
        bottom: rectangle.bottom,
        width: rectangle.width,
        height: rectangle.height
      };
    }
    const selectedSpeed = document.querySelector('.speed-control [aria-pressed="true"]');
    const selectedSpeedRange = document.createRange();
    selectedSpeedRange.selectNodeContents(selectedSpeed);
    const selectedSpeedBox = selectedSpeed.getBoundingClientRect();
    const selectedSpeedTextBox = selectedSpeedRange.getBoundingClientRect();
    return {
      board: box('[data-slot="character-board"]'),
      tools: box('.character-tools'),
      pinyin: box('.character-pinyin'),
      words: box('.character-words'),
      characterDisplay: box('.character-display'),
      practiceStatus: box('.character-practice-status'),
      practiceButton: box('[data-action="start-character-practice"]'),
      audioButton: box('[data-action="play-audio"]'),
      animationStatus: box('.animation-status'),
      strokeControls: box('.stroke-controls'),
      speedControl: box('.speed-control'),
      selectedSpeed: box('.speed-control [aria-pressed="true"]'),
      selectedSpeedCenterDelta: {
        x: Math.abs(
          (selectedSpeedBox.left + (selectedSpeedBox.width / 2))
            - (selectedSpeedTextBox.left + (selectedSpeedTextBox.width / 2))
        ),
        y: Math.abs(
          (selectedSpeedBox.top + (selectedSpeedBox.height / 2))
            - (selectedSpeedTextBox.top + (selectedSpeedTextBox.height / 2))
        )
      }
    };
  });
  assert.equal(intersects(layout.board, layout.tools), false, `${label}: board and tools overlap`);
  assert.equal(
    intersects(layout.practiceButton, layout.audioButton),
    false,
    `${label}: practice and audio buttons overlap ${JSON.stringify(layout)}`
  );
  assert.ok(
    layout.selectedSpeedCenterDelta.x <= 2 && layout.selectedSpeedCenterDelta.y <= 2,
    `${label}: selected speed text is not centered ${JSON.stringify(layout.selectedSpeedCenterDelta)}`
  );
  if (viewport.label === 'MatePad-effective-1000x607') {
    for (const [first, second] of [
      ['pinyin', 'words'],
      ['words', 'practiceStatus'],
      ['practiceStatus', 'practiceButton'],
      ['audioButton', 'animationStatus'],
      ['animationStatus', 'strokeControls'],
      ['strokeControls', 'speedControl']
    ]) {
      assert.ok(
        layout[first].bottom <= layout[second].top + 1,
        `${label}: ${first} is not above ${second} ${JSON.stringify(layout)}`
      );
    }
    assert.equal(
      intersects(layout.characterDisplay, layout.pinyin)
        || intersects(layout.characterDisplay, layout.words),
      false,
      `${label}: character details overlap pronunciation details ${JSON.stringify(layout)}`
    );
  }
  if (viewport.height <= 430) {
    assert.ok(
      layout.selectedSpeed.left >= layout.speedControl.left - 1
        && layout.selectedSpeed.right <= layout.speedControl.right + 1
        && layout.selectedSpeed.top >= layout.speedControl.top - 1
        && layout.selectedSpeed.bottom <= layout.speedControl.bottom + 1,
      `${label}: selected speed overflows its segmented control ${JSON.stringify(layout)}`
    );
    assert.ok(
      layout.strokeControls.bottom <= layout.speedControl.top + 1,
      `${label}: stroke and speed controls are not stacked ${JSON.stringify(layout)}`
    );
    assert.ok(
      layout.animationStatus.bottom <= layout.strokeControls.top + 1,
      `${label}: animation status overlaps stroke controls ${JSON.stringify(layout)}`
    );
  }
  if (viewport.width < 760 && viewport.width <= viewport.height) {
    assert.ok(
      layout.board.bottom <= layout.tools.top + 1,
      `${label}: mobile work surface is not stacked ${JSON.stringify(layout)}`
    );
  } else {
    assert.ok(
      layout.board.right <= layout.tools.left + 1,
      `${label}: wide work surface is not two columns ${JSON.stringify(layout)}`
    );
    assert.ok(
      Math.min(layout.board.bottom, layout.tools.bottom)
        - Math.max(layout.board.top, layout.tools.top) > 40,
      `${label}: wide columns do not share a row ${JSON.stringify(layout)}`
    );
  }
  await assertSelectorsDoNotOverlap(page, [
    '[data-view="character"] .character-topbar',
    '[data-view="character"] > [data-view-heading]',
    '[data-view="character"] .character-navigation'
  ], label);
  await assertSelectorsDoNotOverlap(page, [
    '[data-view="character"] [data-action="back-lesson"]',
    '[data-view="character"] [data-slot="character-position"]'
  ], `${label} topbar`);
}

async function readWorkSurfaceStyle(page, pageType) {
  const selectors = pageType === 'character'
    ? {
      board: '.character-board',
      tools: '.character-tools',
      pinyin: '.character-pinyin',
      character: '.character-display',
      position: '.character-position',
      topbar: '.character-topbar'
    }
    : {
      board: '.practice-board',
      tools: '.practice-tools',
      pinyin: '.practice-pinyin',
      character: '.practice-character',
      position: '.practice-round-position',
      topbar: '.practice-topbar'
    };
  return page.evaluate((requestedSelectors) => {
    function visualStyle(selector, properties) {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      return Object.fromEntries(properties.map((property) => [property, style[property]]));
    }
    function size(selector) {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { width: box.width, height: box.height };
    }
    return {
      boardSize: size(requestedSelectors.board),
      toolsSize: size(requestedSelectors.tools),
      board: visualStyle(requestedSelectors.board, [
        'backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderRadius'
      ]),
      tools: visualStyle(requestedSelectors.tools, [
        'backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderRadius',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'
      ]),
      pinyin: visualStyle(requestedSelectors.pinyin, [
        'color', 'fontSize', 'fontWeight', 'lineHeight', 'textAlign'
      ]),
      character: visualStyle(requestedSelectors.character, [
        'fontFamily', 'fontSize', 'lineHeight', 'textAlign'
      ]),
      position: visualStyle(requestedSelectors.position, [
        'color', 'fontSize', 'fontWeight', 'textAlign'
      ]),
      topbar: visualStyle(requestedSelectors.topbar, [
        'alignItems', 'justifyContent', 'columnGap', 'marginBottom'
      ])
    };
  }, selectors);
}

async function readPortraitWorkSurfaceSpacing(page, pageType) {
  const selectors = pageType === 'character'
    ? {
      heading: '[data-view="character"] > [data-view-heading]',
      board: '.character-board',
      tools: '.character-tools',
      navigation: '[data-view="character"] > .character-navigation'
    }
    : {
      heading: '[data-view="practice"] > [data-view-heading]',
      board: '.practice-board',
      tools: '.practice-tools',
      navigation: '[data-view="practice"] > .practice-navigation'
    };
  return page.evaluate((requestedSelectors) => {
    const heading = document.querySelector(requestedSelectors.heading).getBoundingClientRect();
    const board = document.querySelector(requestedSelectors.board).getBoundingClientRect();
    const tools = document.querySelector(requestedSelectors.tools).getBoundingClientRect();
    const navigation = document.querySelector(requestedSelectors.navigation).getBoundingClientRect();
    return {
      headingToBoard: board.top - heading.bottom,
      boardToTools: tools.top - board.bottom,
      toolsToNavigation: navigation.top - tools.bottom
    };
  }, selectors);
}

async function readCompactNavigationAlignment(page, pageType) {
  const selectors = pageType === 'character'
    ? {
      topbar: '.character-topbar',
      navigation: '[data-view="character"] > .character-navigation'
    }
    : {
      topbar: '.practice-topbar',
      navigation: '[data-view="practice"] > .practice-navigation'
    };
  return page.evaluate((requestedSelectors) => {
    const topbar = document.querySelector(requestedSelectors.topbar).getBoundingClientRect();
    const navigation = document.querySelector(requestedSelectors.navigation).getBoundingClientRect();
    return {
      navigationTop: navigation.top,
      centerOffset: (navigation.top + (navigation.height / 2))
        - (topbar.top + (topbar.height / 2))
    };
  }, selectors);
}

async function readWidePageStructure(page, pageType) {
  const selectors = pageType === 'character'
    ? {
      root: '[data-view="character"]',
      topbar: '.character-topbar',
      heading: '[data-view="character"] > [data-view-heading]',
      board: '.character-board',
      tools: '.character-tools',
      navigation: '[data-view="character"] > .character-navigation'
    }
    : {
      root: '[data-view="practice"]',
      topbar: '.practice-topbar',
      heading: '[data-view="practice"] > [data-view-heading]',
      board: '.practice-board',
      tools: '.practice-tools',
      navigation: '[data-view="practice"] > .practice-navigation'
    };
  return page.evaluate((requestedSelectors) => {
    function box(selector) {
      const rectangle = document.querySelector(selector).getBoundingClientRect();
      return {
        left: rectangle.left,
        top: rectangle.top,
        right: rectangle.right,
        bottom: rectangle.bottom,
        width: rectangle.width,
        height: rectangle.height
      };
    }
    const navigation = document.querySelector(requestedSelectors.navigation);
    const labels = [...navigation.querySelectorAll('span:not(.button-icon)')];
    return {
      root: box(requestedSelectors.root),
      topbar: box(requestedSelectors.topbar),
      heading: box(requestedSelectors.heading),
      board: box(requestedSelectors.board),
      tools: box(requestedSelectors.tools),
      navigation: box(requestedSelectors.navigation),
      navigationLabelsVisible: labels.length === 2 && labels.every((label) => {
        const rectangle = label.getBoundingClientRect();
        return getComputedStyle(label).display !== 'none'
          && rectangle.width > 0
          && rectangle.height > 0;
      })
    };
  }, selectors);
}

function assertWidePageStructure(layout, label) {
  assert.ok(
    Math.abs(layout.topbar.left - layout.root.left) <= 1
      && Math.abs(layout.topbar.right - layout.root.right) <= 1,
    `${label}: topbar does not span the page ${JSON.stringify(layout)}`
  );
  assert.ok(
    layout.topbar.bottom <= layout.heading.top + 1,
    `${label}: topbar is not above the heading ${JSON.stringify(layout)}`
  );
  assert.ok(
    layout.heading.bottom <= Math.min(layout.board.top, layout.tools.top) + 1,
    `${label}: heading is not above the work surface ${JSON.stringify(layout)}`
  );
  assert.ok(
    Math.abs(layout.board.top - layout.tools.top) <= 1,
    `${label}: board and tools do not share a row ${JSON.stringify(layout)}`
  );
  assert.ok(
    layout.navigation.top >= Math.max(layout.board.bottom, layout.tools.bottom) - 1,
    `${label}: navigation is not below the work surface ${JSON.stringify(layout)}`
  );
  assert.equal(layout.navigationLabelsVisible, true, `${label}: navigation labels are hidden`);
}

async function readRenderedGlyphStyle(page, pageType) {
  const selectors = pageType === 'character'
    ? {
      board: '.character-board',
      surface: '.character-board > svg',
      paths: '.hanzi-stroke--ghost',
      colorProperty: 'fill'
    }
    : {
      board: '.practice-board',
      surface: '.practice-writer-host',
      paths: '.practice-writer-host path',
      colorProperty: 'stroke'
    };
  return page.evaluate((requestedSelectors) => {
    const expectedColor = 'rgb(220, 231, 239)';
    const boardBox = document.querySelector(requestedSelectors.board).getBoundingClientRect();
    const surfaceBox = document.querySelector(requestedSelectors.surface).getBoundingClientRect();
    function visibleGlyphBox(path) {
      if (requestedSelectors.colorProperty === 'fill') return path.getBoundingClientRect();
      const clipReference = path.getAttribute('clip-path') || '';
      const clipId = clipReference.match(/#([^"')]+)["']?\)$/)?.[1];
      const glyphPath = clipId && document.getElementById(clipId)?.querySelector('path');
      const matrix = path.getScreenCTM();
      if (!glyphPath || !matrix) return null;
      const box = glyphPath.getBBox();
      const corners = [
        new DOMPoint(box.x, box.y),
        new DOMPoint(box.x + box.width, box.y),
        new DOMPoint(box.x, box.y + box.height),
        new DOMPoint(box.x + box.width, box.y + box.height)
      ].map((point) => point.matrixTransform(matrix));
      const left = Math.min(...corners.map((point) => point.x));
      const top = Math.min(...corners.map((point) => point.y));
      const right = Math.max(...corners.map((point) => point.x));
      const bottom = Math.max(...corners.map((point) => point.y));
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    }
    const pathBoxes = [...document.querySelectorAll(requestedSelectors.paths)]
      .filter((path) => getComputedStyle(path)[requestedSelectors.colorProperty] === expectedColor)
      .map(visibleGlyphBox)
      .filter((box) => box && box.width > 0 && box.height > 0);
    if (pathBoxes.length === 0) return { color: null, pathCount: 0, bounds: null };
    const left = Math.min(...pathBoxes.map((box) => box.left));
    const top = Math.min(...pathBoxes.map((box) => box.top));
    const right = Math.max(...pathBoxes.map((box) => box.right));
    const bottom = Math.max(...pathBoxes.map((box) => box.bottom));
    return {
      color: expectedColor,
      pathCount: pathBoxes.length,
      boardPosition: {
        left: boardBox.left,
        top: boardBox.top,
        width: boardBox.width,
        height: boardBox.height
      },
      boardSize: { width: boardBox.width, height: boardBox.height },
      surfaceSize: { width: surfaceBox.width, height: surfaceBox.height },
      screenBounds: { left, top, width: right - left, height: bottom - top },
      bounds: {
        left: left - boardBox.left,
        top: top - boardBox.top,
        width: right - left,
        height: bottom - top
      }
    };
  }, selectors);
}

function assertWorkSurfaceStyleParity(characterStyle, practiceStyle, label) {
  for (const key of ['board', 'tools', 'pinyin', 'character', 'position', 'topbar']) {
    assert.deepEqual(practiceStyle[key], characterStyle[key], `${label}: ${key} styles differ`);
  }
  for (const key of ['boardSize', 'toolsSize']) {
    const widthTolerance = Math.max(1, characterStyle[key].width * 0.01);
    assert.ok(
      Math.abs(characterStyle[key].width - practiceStyle[key].width) <= widthTolerance,
      `${label}: ${key} widths differ ${JSON.stringify({
        character: characterStyle[key],
        practice: practiceStyle[key],
        tolerance: widthTolerance
      })}`
    );
  }
}

function assertRenderedGlyphStyleParity(characterGlyph, practiceGlyph, label) {
  assert.equal(characterGlyph.color, 'rgb(220, 231, 239)', `${label}: learning glyph color`);
  assert.equal(practiceGlyph.color, characterGlyph.color, `${label}: practice glyph color`);
  assert.ok(characterGlyph.pathCount > 0, `${label}: learning glyph paths missing`);
  assert.ok(practiceGlyph.pathCount > 0, `${label}: practice glyph paths missing`);
  for (const dimension of ['left', 'top', 'width', 'height']) {
    assert.ok(
      Math.abs(characterGlyph.bounds[dimension] - practiceGlyph.bounds[dimension]) <= 2,
      `${label}: glyph ${dimension} differs ${JSON.stringify({
        character: characterGlyph,
        practice: practiceGlyph
      })}`
    );
  }
}

function assertStableWorkSurfaceTransition(characterGlyph, practiceGlyph, label) {
  for (const dimension of ['left', 'top', 'width', 'height']) {
    assert.ok(
      Math.abs(characterGlyph.boardPosition[dimension] - practiceGlyph.boardPosition[dimension]) <= 1,
      `${label}: board ${dimension} shifts between pages ${JSON.stringify({
        character: characterGlyph,
        practice: practiceGlyph
      })}`
    );
    assert.ok(
      Math.abs(characterGlyph.screenBounds[dimension] - practiceGlyph.screenBounds[dimension]) <= 1,
      `${label}: glyph ${dimension} shifts between pages ${JSON.stringify({
        character: characterGlyph,
        practice: practiceGlyph
      })}`
    );
  }
}

async function assertTextIsNotClipped(page, selectors, label) {
  const clipped = await page.evaluate((requestedSelectors) => requestedSelectors.flatMap((selector) => {
    const element = document.querySelector(selector);
    if (!element) return [{ selector, missing: true }];
    const style = getComputedStyle(element);
    return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
      ? [{
        selector,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflow: style.overflow,
        text: element.textContent
      }]
      : [];
  }), selectors);
  assert.deepEqual(clipped, [], `${label}: clipped text ${JSON.stringify(clipped)}`);
}

async function assertSelectorsAreContained(page, containerSelector, selectors, label) {
  const overflow = await page.evaluate(({ container, children }) => {
    const containerBox = document.querySelector(container).getBoundingClientRect();
    return children.flatMap((selector) => {
      const child = document.querySelector(selector);
      if (!child) return [{ selector, missing: true }];
      const childBox = child.getBoundingClientRect();
      return childBox.left < containerBox.left - 1 || childBox.right > containerBox.right + 1
        ? [{
          selector,
          containerLeft: containerBox.left,
          containerRight: containerBox.right,
          childLeft: childBox.left,
          childRight: childBox.right
        }]
        : [];
    });
  }, { container: containerSelector, children: selectors });
  assert.deepEqual(overflow, [], `${label}: controls escape their container ${JSON.stringify(overflow)}`);
}

async function assertInlineContentInset(page, selector, minimum, label) {
  const insets = await page.locator(selector).evaluate((container) => {
    const containerBox = container.getBoundingClientRect();
    const childBoxes = [...container.children]
      .filter((child) => getComputedStyle(child).display !== 'none')
      .map((child) => child.getBoundingClientRect());
    return {
      left: Math.min(...childBoxes.map((box) => box.left)) - containerBox.left,
      right: containerBox.right - Math.max(...childBoxes.map((box) => box.right))
    };
  });
  assert.ok(
    insets.left >= minimum && insets.right >= minimum,
    `${label}: content touches an inline edge ${JSON.stringify(insets)}`
  );
}

async function assertVerticalGap(page, upperSelector, lowerSelector, minimum, label) {
  const [upper, lower] = await Promise.all([
    page.locator(upperSelector).boundingBox(),
    page.locator(lowerSelector).boundingBox()
  ]);
  assert.ok(upper && lower, `${label}: missing element geometry`);
  const gap = lower.y - (upper.y + upper.height);
  assert.ok(gap >= minimum, `${label}: vertical gap is ${gap}px`);
}

async function assertPracticeCommon(page, label) {
  await assertNoHorizontalOverflow(page, label);
  await assertVisibleTargetsAreLargeEnough(page, label);
  await assertTextIsNotClipped(page, [
    '.practice-topbar .back-button',
    '.practice-lesson-title',
    '[data-view-heading]'
  ], label);
  await assertSelectorsDoNotOverlap(page, [
    '.practice-topbar',
    '.practice-lesson-title',
    '.practice-group-label',
    '[data-view-heading]'
  ], label);
  const compactTopbar = await page.evaluate(() => {
    const topbar = document.querySelector('.practice-topbar--single');
    if (!topbar || innerHeight > 430) return null;
    const back = topbar.querySelector('.practice-back--single');
    const position = topbar.querySelector('.practice-round-position');
    const navigation = document.querySelector('.practice-navigation');
    return {
      backHeight: back.getBoundingClientRect().height,
      positionHeight: position.getBoundingClientRect().height,
      navigationHeight: navigation.getBoundingClientRect().height
    };
  });
  if (compactTopbar) {
    assert.ok(compactTopbar.backHeight <= 45,
      `${label}: practice back label wrapped ${JSON.stringify(compactTopbar)}`);
    assert.ok(compactTopbar.positionHeight <= 20,
      `${label}: practice position wrapped ${JSON.stringify(compactTopbar)}`);
    assert.ok(compactTopbar.navigationHeight <= 45,
      `${label}: practice navigation wrapped ${JSON.stringify(compactTopbar)}`);
  }
}

async function assertPracticeResultActions(page, resultSelector, label) {
  const buttons = await page.locator(`${resultSelector} > .practice-actions > button`)
    .evaluateAll((actions) => actions.map((action) => {
      const box = action.getBoundingClientRect();
      return {
        text: action.textContent.trim(),
        width: box.width,
        height: box.height
      };
    }));
  assert.ok(buttons.length > 0, `${label}: result has no actions`);
  for (const button of buttons) {
    assert.ok(button.width >= 120, `${label}: result action is too narrow ${JSON.stringify(button)}`);
    assert.ok(button.height <= 72, `${label}: result action is too tall ${JSON.stringify(button)}`);
  }
}

async function assertPracticeActiveGeometry(page, viewport, phase, label) {
  await assertPracticeCommon(page, label);
  const board = page.locator('[data-slot="practice-board"]');
  const grid = board.locator(':scope > .practice-grid');
  assert.equal(await grid.count(), 1, `${label}: practice grid is missing`);
  assert.equal(await grid.getAttribute('aria-hidden'), 'true');
  assert.equal(await grid.locator('.hanzi-grid__border').count(), 1);
  assert.equal(await grid.locator('.hanzi-grid__axis').count(), 2);
  assert.equal(await grid.locator('.hanzi-grid__diagonal').count(), 2);
  assert.deepEqual(
    await board.locator(':scope > *').evaluateAll((children) => children.map((child) => child.className.baseVal || child.className)),
    ['practice-grid', 'practice-writer-host', 'practice-overlay'],
    `${label}: practice board layers are out of order`
  );
  const before = await board.boundingBox();
  assert.ok(before, `${label}: board has no bounding box`);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => (
    requestAnimationFrame(resolve)
  ))));
  await page.waitForTimeout(120);
  const after = await board.boundingBox();
  assert.ok(after, `${label}: board disappeared`);
  assert.ok(Math.abs(before.width - before.height) <= 1.5, `${label}: board is not square ${JSON.stringify(before)}`);
  assert.ok(Math.abs(after.width - after.height) <= 1.5, `${label}: board stopped being square ${JSON.stringify(after)}`);
  assert.ok(
    Math.abs(before.width - after.width) <= 1 && Math.abs(before.height - after.height) <= 1,
    `${label}: board shifted ${JSON.stringify({ before, after })}`
  );

  const geometry = await page.evaluate(() => {
    function box(selector) {
      const rectangle = document.querySelector(selector).getBoundingClientRect();
      return {
        left: rectangle.left,
        right: rectangle.right,
        top: rectangle.top,
        bottom: rectangle.bottom,
        width: rectangle.width,
        height: rectangle.height
      };
    }
    const writerHost = document.querySelector('.practice-writer-host');
    const writerPaths = [...document.querySelectorAll('.practice-writer-host svg path')];
    const dot = document.querySelector('.practice-start-dot');
    const dotBox = dot ? dot.getBoundingClientRect() : null;
    const writerHostStyle = writerHost ? getComputedStyle(writerHost) : null;
    return {
      board: box('[data-slot="practice-board"]'),
      tools: box('.practice-tools'),
      topbar: box('.practice-topbar'),
      lesson: box('.practice-lesson-title'),
      group: box('.practice-group-label'),
      heading: box('[data-view="practice"] > [data-view-heading]'),
      pinyin: box('.practice-pinyin'),
      character: box('.practice-character'),
      phase: box('.practice-phase'),
      strokePosition: box('.practice-stroke-position'),
      feedback: box('.practice-feedback'),
      progress: box('.practice-progress'),
      actions: box('.practice-actions'),
      writer: box('.practice-writer-host'),
      overlay: box('.practice-overlay'),
      writerPathCount: writerPaths.filter((path) => (path.getAttribute('d') || '').trim() !== '').length,
      writerVisiblePathCount: writerPaths.filter((path) => {
        if (!(path.getAttribute('d') || '').trim()) return false;
        const style = getComputedStyle(path);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
      }).length,
      writerHostVisible: writerHostStyle
        && writerHostStyle.display !== 'none'
        && writerHostStyle.visibility !== 'hidden'
        && Number(writerHostStyle.opacity) > 0,
      dot: dotBox && {
        centerX: dotBox.left + (dotBox.width / 2),
        centerY: dotBox.top + (dotBox.height / 2),
        width: dotBox.width,
        height: dotBox.height
      }
    };
  });
  assert.equal(intersects(geometry.board, geometry.tools), false, `${label}: board and tools overlap`);
  for (const area of ['topbar', 'lesson', 'group', 'heading']) {
    assert.equal(
      intersects(geometry.board, geometry[area]),
      false,
      `${label}: board and ${area} overlap ${JSON.stringify(geometry)}`
    );
  }
  if (viewport.width < 760 && viewport.width <= viewport.height) {
    assert.ok(geometry.board.bottom <= geometry.tools.top + 1,
      `${label}: mobile practice surface is not stacked ${JSON.stringify(geometry)}`);
  } else {
    assert.ok(geometry.board.right <= geometry.tools.left + 1,
      `${label}: desktop practice surface is not two columns ${JSON.stringify(geometry)}`);
  }
  if (viewport.label === 'MatePad-effective-1000x607') {
    for (const [first, second] of [
      ['pinyin', 'phase'],
      ['phase', 'strokePosition'],
      ['character', 'strokePosition'],
      ['strokePosition', 'feedback'],
      ['feedback', 'progress'],
      ['progress', 'actions']
    ]) {
      assert.ok(
        geometry[first].bottom <= geometry[second].top + 1,
        `${label}: ${first} is not above ${second} ${JSON.stringify(geometry)}`
      );
    }
    assert.equal(
      intersects(geometry.character, geometry.pinyin)
        || intersects(geometry.character, geometry.phase),
      false,
      `${label}: character details overlap practice labels ${JSON.stringify(geometry)}`
    );
  }
  if (viewport.height <= 430) {
    await assertSelectorsAreContained(page, '.practice-tools', [
      '.practice-character',
      '.practice-pinyin',
      '.practice-phase',
      '.practice-stroke-position',
      '.practice-feedback',
      '.practice-progress',
      '.practice-actions'
    ], `${label} tools`);
  }
  assert.ok(geometry.writerPathCount > 0, `${label}: writer SVG has no path data`);
  assert.equal(geometry.writerHostVisible, true, `${label}: writer host is not visible`);
  if (phase === '引导描写') {
    assert.ok(geometry.writerVisiblePathCount > 0, `${label}: guided writer has no visible paths`);
  }
  assert.ok(geometry.dot && geometry.dot.width > 0 && geometry.dot.height > 0,
    `${label}: practice overlay has no visible start dot`);
  assert.ok(Math.abs(geometry.writer.left - geometry.overlay.left) <= 1,
    `${label}: writer and overlay left edges differ ${JSON.stringify(geometry)}`);
  assert.ok(Math.abs(geometry.writer.top - geometry.overlay.top) <= 1,
    `${label}: writer and overlay top edges differ ${JSON.stringify(geometry)}`);
  assert.ok(Math.abs(geometry.writer.width - geometry.overlay.width) <= 1,
    `${label}: writer and overlay widths differ ${JSON.stringify(geometry)}`);
  assert.ok(Math.abs(geometry.writer.height - geometry.overlay.height) <= 1,
    `${label}: writer and overlay heights differ ${JSON.stringify(geometry)}`);
  assert.ok(geometry.dot.centerX > geometry.board.left && geometry.dot.centerX < geometry.board.right,
    `${label}: start dot is outside board horizontally ${JSON.stringify(geometry)}`);
  assert.ok(geometry.dot.centerY > geometry.board.top && geometry.dot.centerY < geometry.board.bottom,
    `${label}: start dot is outside board vertically ${JSON.stringify(geometry)}`);
  const expectedStart = (await mappedPracticeMedian(page, 0))[0];
  assert.ok(
    Math.hypot(geometry.dot.centerX - expectedStart.x, geometry.dot.centerY - expectedStart.y) <= 2,
    `${label}: start dot is not aligned to the first median ${JSON.stringify({ dot: geometry.dot, expectedStart })}`
  );
  const boardRaster = await analyzePracticeBoardRaster(page, board);
  assert.ok(boardRaster.redPixels >= 20, `${label}: board raster has no visible red start dot ${JSON.stringify(boardRaster)}`);
  if (phase === '引导描写') {
    assert.ok(
      boardRaster.inkPixels >= boardRaster.width * boardRaster.height * 0.02,
      `${label}: guided board raster has no visible glyph ${JSON.stringify(boardRaster)}`
    );
  }
  assert.equal(await board.getAttribute('role'), 'img');
  assert.match(
    await board.getAttribute('aria-label'),
    new RegExp(`${PRACTICE_CHARACTER}.*${phase}.*\u7b2c1\u7b14.*\u51719\u7b14`)
  );
  assert.equal(await page.locator('[data-action="practice-hint"]').getAttribute('aria-label'), '提示当前笔');
  assert.equal(await page.locator('[data-slot="practice-feedback"]').getAttribute('aria-live'), 'polite');
  assert.equal(await page.locator('[data-slot="practice-feedback"]').getAttribute('aria-atomic'), 'true');
  await assertTextIsNotClipped(page, [
    '.practice-phase',
    '[data-slot="practice-stroke-position"]',
    '[data-slot="practice-feedback"]',
    '.practice-actions'
  ], label);
}

async function capturePracticeScreenshot(page, artifactPath, viewport, state) {
  const label = `${viewport.label} practice ${state}`;
  await saveFullPageScreenshot(
    page,
    artifactPath(`${viewport.label}-practice-${state}.png`),
    label
  );
}

function trustedTouchPoint(point, id) {
  return {
    x: point.x,
    y: point.y,
    id,
    radiusX: 4,
    radiusY: 4,
    force: 0.5
  };
}

async function dispatchTouchGesture(client, points, id = 1) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [trustedTouchPoint(points[0], id)]
  });
  for (const point of points.slice(1)) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [trustedTouchPoint(point, id)]
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function drawPracticeCharacterWithTouch(client, page) {
  const strokeCount = await page.evaluate((character) => (
    window.HANZI_LIBRARY.characters[character].strokeCount
  ), PRACTICE_CHARACTER);
  for (let index = 0; index < strokeCount; index += 1) {
    await dispatchTouchGesture(client, await mappedPracticeMedian(page, index), index + 20);
    if (index + 1 < strokeCount) await waitForPracticeStroke(page, index + 2, strokeCount);
  }
}

export async function registerBrowserTests({ test }) {
  for (const viewport of VIEWPORTS) {
    test(`offline responsive layout at ${viewport.label}`, async ({
      indexUrl,
      openPage,
      artifactPath
    }) => {
      const page = await openPage({ viewport, reducedMotion: true });

      await page.goto(indexUrl, { waitUntil: 'load' });
      await waitForView(page, 'directory');
      await assertNoHorizontalOverflow(page, `${viewport.label} directory`);
      await assertVisibleTargetsAreLargeEnough(page, `${viewport.label} directory`);
      await assertDirectoryGeometry(page, `${viewport.label} directory`);
      await saveFullPageScreenshot(
        page,
        artifactPath(`${viewport.label}-directory.png`),
        `${viewport.label} directory`
      );

      await page.goto(
        withHash(indexUrl, lessonHash('g4f-02', 'write')),
        { waitUntil: 'load' }
      );
      await waitForView(page, 'lesson');
      await assertNoHorizontalOverflow(page, `${viewport.label} lesson`);
      await assertVisibleTargetsAreLargeEnough(page, `${viewport.label} lesson`);
      await assertLessonGeometry(page, `${viewport.label} lesson`);
      await saveFullPageScreenshot(
        page,
        artifactPath(`${viewport.label}-g4f-02-write.png`),
        `${viewport.label} lesson`
      );

      await page.goto(
        withHash(indexUrl, characterHash('g4f-02', 'write', '砂')),
        { waitUntil: 'load' }
      );
      await waitForView(page, 'character');
      await assertNoHorizontalOverflow(page, `${viewport.label} character`);
      await assertVisibleTargetsAreLargeEnough(page, `${viewport.label} character`);
      await assertCharacterGeometry(page, viewport, `${viewport.label} character`);
      await saveFullPageScreenshot(
        page,
        artifactPath(`${viewport.label}-g4f-02-write-su.png`),
        `${viewport.label} character`
      );
    });
  }

  for (const viewport of LANDSCAPE_VIEWPORTS) {
    test(`character fits ${viewport.label} without vertical scrolling`, async ({
      indexUrl,
      openPage,
      artifactPath
    }) => {
      const page = await openPage({ viewport, reducedMotion: true });
      await page.goto(
        withHash(indexUrl, characterHash('g4f-02', 'write', '砂')),
        { waitUntil: 'load' }
      );
      await waitForView(page, 'character');
      await assertCharacterGeometry(page, viewport, `${viewport.label} character`);
      const verticalLayout = await page.evaluate(() => ({
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
        headerDisplay: getComputedStyle(document.querySelector('.site-header')).display,
        headingDisplay: getComputedStyle(
          document.querySelector('.view--character > .view-heading')
        ).display,
        headingText: document.querySelector('.view--character > .view-heading').textContent,
        headingHeight: document.querySelector(
          '.view--character > .view-heading'
        ).getBoundingClientRect().height,
        boardBottom: document.querySelector('.character-board').getBoundingClientRect().bottom,
        toolsBottom: document.querySelector('.character-tools').getBoundingClientRect().bottom,
        navigationBottom: document.querySelector('.character-navigation').getBoundingClientRect().bottom,
        controlsBottom: Math.max(...[...document.querySelectorAll('.view--character button')]
          .map((button) => button.getBoundingClientRect().bottom))
      }));
      assert.ok(
        verticalLayout.scrollHeight <= verticalLayout.clientHeight + 1,
        `${viewport.label}: character page requires vertical scrolling ${JSON.stringify(verticalLayout)}`
      );
      assert.ok(
        verticalLayout.navigationBottom <= verticalLayout.clientHeight,
        `${viewport.label}: character navigation is below the viewport ${JSON.stringify(verticalLayout)}`
      );
      if (viewport.height <= 430) {
        assert.equal(verticalLayout.headerDisplay, 'none', `${viewport.label}: phone header remains visible`);
        assert.notEqual(verticalLayout.headingDisplay, 'none', `${viewport.label}: learning heading is hidden`);
        assert.equal(verticalLayout.headingText, '学习“砂”', `${viewport.label}: learning heading is incorrect`);
        assert.ok(verticalLayout.headingHeight > 0, `${viewport.label}: learning heading has no height`);
        assert.ok(
          Math.max(
            verticalLayout.boardBottom,
            verticalLayout.toolsBottom,
            verticalLayout.navigationBottom,
            verticalLayout.controlsBottom
          ) <= verticalLayout.clientHeight - 8,
          `${viewport.label}: phone character content enters the bottom safe area ${JSON.stringify(verticalLayout)}`
        );
        await assertSelectorsAreContained(page, '.character-tools', [
          '.character-pinyin',
          '.character-practice-status',
          '.character-practice-start',
          '.button--audio',
          '.animation-status',
          '.stroke-controls',
          '.speed-control'
        ], `${viewport.label} character tools`);
        await assertTextIsNotClipped(page, [
          '.character-pinyin',
          '.character-practice-status',
          '.character-practice-start',
          '.button--audio',
          '.animation-status',
          '.speed-control [data-speed="slow"]',
          '.speed-control [data-speed="normal"]',
          '.speed-control [data-speed="fast"]'
        ], `${viewport.label} character tools`);
      }
      await saveFullPageScreenshot(
        page,
        artifactPath(`${viewport.label}-character-fit.png`),
        `${viewport.label} character fit`
      );
    });
  }

  test('long learning metadata fits phone landscape without clipping', async ({
    indexUrl,
    openPage,
    artifactPath
  }) => {
    const viewport = PHONE_LANDSCAPE_VIEWPORTS[2];
    const page = await openPage({ viewport, reducedMotion: true });
    await page.goto(
      withHash(indexUrl, characterHash('g4f-01', 'write', '宴')),
      { waitUntil: 'load' }
    );
    await waitForView(page, 'character');
    assert.equal(await page.locator('.character-pinyin').textContent(), 'yàn');
    assert.equal(await page.locator('.character-words').textContent(), '组词：宴会  晚宴');
    assert.equal(await page.locator('.character-words').evaluate(
      (words) => getComputedStyle(words).display
    ), 'none');
    await assertNoHorizontalOverflow(page, `${viewport.label} 宴 learning`);
    await assertSelectorsAreContained(page, '.character-tools', [
      '.character-pinyin',
      '.character-practice-status',
      '.character-practice-start',
      '.button--audio',
      '.stroke-controls',
      '.speed-control'
    ], `${viewport.label} 宴 learning`);
    await assertTextIsNotClipped(page, [
      '.character-pinyin',
      '.character-practice-status',
      '.character-practice-start',
      '.button--audio',
      '.speed-control [data-speed="slow"]',
      '.speed-control [data-speed="normal"]',
      '.speed-control [data-speed="fast"]'
    ], `${viewport.label} 宴 learning`);
    await saveFullPageScreenshot(
      page,
      artifactPath(`${viewport.label}-ju-long-metadata.png`),
      `${viewport.label} 宴 learning metadata`
    );
  });

  for (const viewport of PHONE_TOOL_BOUNDARY_VIEWPORTS) {
    test(`learning tools switch cleanly at ${viewport.label}`, async ({
      indexUrl,
      openPage,
      artifactPath
    }) => {
      const page = await openPage({ viewport, reducedMotion: true });
      await page.goto(
        withHash(indexUrl, characterHash('g4f-02', 'write', '砂')),
        { waitUntil: 'load' }
      );
      await waitForView(page, 'character');
      await assertNoHorizontalOverflow(page, `${viewport.label} learning tools`);
      await assertVisibleTargetsAreLargeEnough(page, `${viewport.label} learning tools`);
      await assertCharacterGeometry(page, viewport, `${viewport.label} learning tools`);
      const visibleToolSelectors = [
        '.character-pinyin',
        '.character-practice-status',
        '.character-practice-start',
        '.button--audio',
        '.animation-status',
        '.stroke-controls',
        '.speed-control'
      ];
      if (viewport.width >= 960) visibleToolSelectors.push('.character-words');
      await assertSelectorsAreContained(
        page,
        '.character-tools',
        visibleToolSelectors,
        `${viewport.label} learning tools`
      );
      await saveFullPageScreenshot(
        page,
        artifactPath(`${viewport.label}-learning-tools.png`),
        `${viewport.label} learning tools`
      );
    });
  }

  for (const viewport of PAGE_STYLE_PARITY_VIEWPORTS) {
    test(`learning and practice styles match at ${viewport.label}`, async ({
      indexUrl,
      openPage,
      artifactPath
    }) => {
      const page = await openPage({ viewport, reducedMotion: true });
      await page.goto(
        withHash(indexUrl, characterHash('g4f-02', 'write', PRACTICE_CHARACTER)),
        { waitUntil: 'load' }
      );
      await waitForView(page, 'character');
      const characterStyle = await readWorkSurfaceStyle(page, 'character');
      const characterGlyph = await readRenderedGlyphStyle(page, 'character');
      const characterHeadingTop = await page.locator(
        '[data-view="character"] > [data-view-heading]'
      ).evaluate((heading) => heading.getBoundingClientRect().top);
      const characterHeadingFontSize = await page.locator(
        '[data-view="character"] > [data-view-heading]'
      ).evaluate((heading) => getComputedStyle(heading).fontSize);
      const characterSpacing = viewport.width < 760 && viewport.height > viewport.width
        ? await readPortraitWorkSurfaceSpacing(page, 'character')
        : null;
      const characterNavigation = viewport.width > viewport.height && viewport.height <= 430
        ? await readCompactNavigationAlignment(page, 'character')
        : null;
      const characterWideStructure = viewport.width >= 760 && viewport.height > 430
        ? await readWidePageStructure(page, 'character')
        : null;

      await page.goto(withHash(
        indexUrl,
        practiceHash('g4f-02', 'write', 'single', PRACTICE_CHARACTER)
      ), { waitUntil: 'load' });
      await waitForPractice(page, '引导描写');
      const practiceStyle = await readWorkSurfaceStyle(page, 'practice');
      const practiceGlyph = await readRenderedGlyphStyle(page, 'practice');
      const practiceHeadingTop = await page.locator(
        '[data-view="practice"] > [data-view-heading]'
      ).evaluate((heading) => heading.getBoundingClientRect().top);
      const practiceHeadingFontSize = await page.locator(
        '[data-view="practice"] > [data-view-heading]'
      ).evaluate((heading) => getComputedStyle(heading).fontSize);
      const practiceSpacing = viewport.width < 760 && viewport.height > viewport.width
        ? await readPortraitWorkSurfaceSpacing(page, 'practice')
        : null;
      const practiceNavigation = viewport.width > viewport.height && viewport.height <= 430
        ? await readCompactNavigationAlignment(page, 'practice')
        : null;
      const practiceWideStructure = viewport.width >= 760 && viewport.height > 430
        ? await readWidePageStructure(page, 'practice')
        : null;

      assertWorkSurfaceStyleParity(
        characterStyle,
        practiceStyle,
        `${viewport.label} learning/practice`
      );
      assertRenderedGlyphStyleParity(
        characterGlyph,
        practiceGlyph,
        `${viewport.label} learning/practice`
      );
      assert.equal(
        characterHeadingFontSize,
        practiceHeadingFontSize,
        `${viewport.label}: learning/practice heading font sizes differ`
      );
      if (viewport.width < 760 && viewport.height > viewport.width) {
        assert.ok(
          Math.abs(characterHeadingTop - practiceHeadingTop) <= 1,
          `${viewport.label}: learning/practice heading tops differ ${JSON.stringify({
            characterHeadingTop,
            practiceHeadingTop
          })}`
        );
        for (const spacing of ['headingToBoard', 'boardToTools', 'toolsToNavigation']) {
          assert.ok(
            Math.abs(characterSpacing[spacing] - practiceSpacing[spacing]) <= 1,
            `${viewport.label}: learning/practice ${spacing} differs ${JSON.stringify({
              characterSpacing,
              practiceSpacing
            })}`
          );
        }
      }
      if (viewport.width > viewport.height && viewport.height <= 430) {
        assert.ok(
          Math.abs(characterNavigation.centerOffset) <= 1
            && Math.abs(practiceNavigation.centerOffset) <= 1,
          `${viewport.label}: compact navigation is not centered on its topbar ${JSON.stringify({
            characterNavigation,
            practiceNavigation
          })}`
        );
      }
      if (viewport.width >= 760 && viewport.height > 430) {
        assertWidePageStructure(characterWideStructure, `${viewport.label} learning`);
        assertWidePageStructure(practiceWideStructure, `${viewport.label} practice`);
        for (const key of ['topbar', 'heading', 'board']) {
          assert.ok(
            Math.abs(characterWideStructure[key].top - practiceWideStructure[key].top) <= 1,
            `${viewport.label}: learning/practice ${key} tops differ ${JSON.stringify({
              character: characterWideStructure[key],
              practice: practiceWideStructure[key]
            })}`
          );
        }
        assertStableWorkSurfaceTransition(
          characterGlyph,
          practiceGlyph,
          `${viewport.label} learning/practice`
        );
      }
      await saveFullPageScreenshot(
        page,
        artifactPath(`${viewport.label}-practice-style-parity.png`),
        `${viewport.label} practice style parity`
      );
    });
  }

  for (const viewport of PHONE_LANDSCAPE_VIEWPORTS) {
    test(`directory is dense enough at ${viewport.label}`, async ({
      indexUrl,
      openPage,
      artifactPath
    }) => {
      const page = await openPage({ viewport, reducedMotion: true });
      await page.goto(indexUrl, { waitUntil: 'load' });
      await waitForView(page, 'directory');
      await assertNoHorizontalOverflow(page, `${viewport.label} directory`);
      await assertVisibleTargetsAreLargeEnough(page, `${viewport.label} directory`);
      const visibleLessonRows = await page.locator('.lesson-row').evaluateAll((rows) => rows.filter((row) => {
        const box = row.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= document.documentElement.clientHeight;
      }).length);
      assert.ok(
        visibleLessonRows >= 3,
        `${viewport.label}: expected at least 3 complete lesson rows, found ${visibleLessonRows}`
      );
      await saveFullPageScreenshot(
        page,
        artifactPath(`${viewport.label}-directory-density.png`),
        `${viewport.label} directory density`
      );
    });
  }

  for (const viewport of COMPACT_TABLET_LANDSCAPE_VIEWPORTS) {
    test(`directory remains readable at ${viewport.label}`, async ({
      indexUrl,
      openPage,
      artifactPath
    }) => {
      const page = await openPage({ viewport, reducedMotion: true });
      await page.goto(indexUrl, { waitUntil: 'load' });
      await waitForView(page, 'directory');
      await assertNoHorizontalOverflow(page, `${viewport.label} directory readability`);
      await assertVisibleTargetsAreLargeEnough(page, `${viewport.label} directory readability`);
      const geometry = await page.locator('.lesson-row').first().evaluate((row) => ({
        rowHeight: row.getBoundingClientRect().height,
        titleFontSize: Number.parseFloat(getComputedStyle(row.querySelector('.lesson-row__title')).fontSize),
        countFontSize: Number.parseFloat(getComputedStyle(row.querySelector('.count')).fontSize)
      }));
      assert.ok(geometry.rowHeight >= 56, `${viewport.label}: directory row is too short ${JSON.stringify(geometry)}`);
      assert.ok(geometry.titleFontSize >= 18, `${viewport.label}: lesson title is too small ${JSON.stringify(geometry)}`);
      assert.ok(geometry.countFontSize >= 14, `${viewport.label}: count label is too small ${JSON.stringify(geometry)}`);
      await saveFullPageScreenshot(
        page,
        artifactPath(`${viewport.label}-directory-readable.png`),
        `${viewport.label} directory readability`
      );
    });
  }

  for (const viewport of COMPACT_LESSON_LANDSCAPE_VIEWPORTS) {
    test(`lesson fits ${viewport.label} without vertical scrolling`, async ({
      indexUrl,
      openPage,
      artifactPath
    }) => {
      const page = await openPage({ viewport, reducedMotion: true });
      await page.goto(withHash(indexUrl, lessonHash('g4f-01', 'write')), { waitUntil: 'load' });
      await waitForView(page, 'lesson');
      assert.equal(await page.locator('.character-card').count(), 15);
      await assertNoHorizontalOverflow(page, `${viewport.label} lesson`);
      await assertVisibleTargetsAreLargeEnough(page, `${viewport.label} lesson`);
      const verticalLayout = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.character-card')];
        return {
          clientHeight: document.documentElement.clientHeight,
          scrollHeight: document.documentElement.scrollHeight,
          headerDisplay: getComputedStyle(document.querySelector('.site-header')).display,
          minimumCardWidth: Math.min(...cards.map((card) => card.getBoundingClientRect().width)),
          minimumCardHeight: Math.min(...cards.map((card) => card.getBoundingClientRect().height)),
          maximumCardWidth: Math.max(...cards.map((card) => card.getBoundingClientRect().width)),
          cardsBottom: Math.max(...cards.map((card) => card.getBoundingClientRect().bottom)),
          startBottom: document.querySelector('.lesson-start').getBoundingClientRect().bottom
        };
      });
      assert.ok(
        verticalLayout.scrollHeight <= verticalLayout.clientHeight + 1,
        `${viewport.label}: lesson page requires vertical scrolling ${JSON.stringify(verticalLayout)}`
      );
      assert.ok(
        Math.max(verticalLayout.cardsBottom, verticalLayout.startBottom) <= verticalLayout.clientHeight,
        `${viewport.label}: lesson content is below the viewport ${JSON.stringify(verticalLayout)}`
      );
      if (viewport.height >= 431) {
        assert.ok(
          Math.min(verticalLayout.minimumCardWidth, verticalLayout.minimumCardHeight) >= 112,
          `${viewport.label}: tablet character cards are too small ${JSON.stringify(verticalLayout)}`
        );
        assert.ok(
          verticalLayout.maximumCardWidth <= 160.5,
          `${viewport.label}: tablet character cards exceed the planned maximum ${JSON.stringify(verticalLayout)}`
        );
      } else {
        assert.equal(verticalLayout.headerDisplay, 'none', `${viewport.label}: phone header remains visible`);
        assert.ok(
          Math.max(verticalLayout.cardsBottom, verticalLayout.startBottom) <= verticalLayout.clientHeight - 8,
          `${viewport.label}: phone lesson content enters the bottom safe area ${JSON.stringify(verticalLayout)}`
        );
      }
      await saveFullPageScreenshot(
        page,
        artifactPath(`${viewport.label}-lesson-fit.png`),
        `${viewport.label} lesson fit`
      );
    });
  }

  for (const viewport of LANDSCAPE_VIEWPORTS) {
    test(`practice fits ${viewport.label} without vertical scrolling`, async ({
      indexUrl,
      openPage,
      artifactPath
    }) => {
      const page = await openPage({ viewport, reducedMotion: true });
      await page.goto(withHash(
        indexUrl,
        practiceHash('g4f-02', 'write', 'single', PRACTICE_CHARACTER)
      ), { waitUntil: 'load' });
      await waitForPractice(page, '引导描写');
      await assertPracticeActiveGeometry(
        page,
        viewport,
        '引导描写',
        `${viewport.label} practice`
      );
      const verticalLayout = await page.evaluate(() => ({
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
        lessonDisplay: getComputedStyle(document.querySelector('.practice-lesson-title')).display,
        groupDisplay: getComputedStyle(document.querySelector('.practice-group-label')).display,
        boardBottom: document.querySelector('.practice-board').getBoundingClientRect().bottom,
        toolsBottom: document.querySelector('.practice-tools').getBoundingClientRect().bottom,
        navigationTop: document.querySelector('.practice-navigation').getBoundingClientRect().top,
        navigationBottom: document.querySelector('.practice-navigation').getBoundingClientRect().bottom
      }));
      assert.ok(
        verticalLayout.scrollHeight <= verticalLayout.clientHeight + 1,
        `${viewport.label}: practice page requires vertical scrolling ${JSON.stringify(verticalLayout)}`
      );
      assert.ok(
        Math.max(
          verticalLayout.boardBottom,
          verticalLayout.toolsBottom,
          verticalLayout.navigationBottom
        ) <= verticalLayout.clientHeight,
        `${viewport.label}: practice content is below the viewport ${JSON.stringify(verticalLayout)}`
      );
      if (viewport.height <= 430) {
        assert.equal(
          verticalLayout.lessonDisplay,
          'none',
          `${viewport.label}: phone practice lesson label remains visible`
        );
        assert.equal(
          verticalLayout.groupDisplay,
          'none',
          `${viewport.label}: phone practice group label remains visible`
        );
        assert.ok(
          Math.max(
            verticalLayout.boardBottom,
            verticalLayout.toolsBottom,
            verticalLayout.navigationBottom
          )
            <= verticalLayout.clientHeight - 8,
          `${viewport.label}: practice content enters the bottom safe area ${JSON.stringify(verticalLayout)}`
        );
      } else {
        assert.ok(
          verticalLayout.navigationTop
            >= Math.max(verticalLayout.boardBottom, verticalLayout.toolsBottom) - 1,
          `${viewport.label}: practice character navigation is not below the work surface ${JSON.stringify(verticalLayout)}`
        );
      }
      await saveFullPageScreenshot(
        page,
        artifactPath(`${viewport.label}-practice-fit.png`),
        `${viewport.label} practice fit`
      );
    });
  }

  for (const viewport of PRACTICE_STATE_VIEWPORTS) {
    test(`practice responsive states at ${viewport.label}`, async ({
      indexUrl,
      openPage,
      artifactPath
    }) => {
      const page = await openPage({ viewport, reducedMotion: true });
      await page.goto(withHash(indexUrl, lessonHash('g4f-02', 'write')), { waitUntil: 'load' });
      await waitForView(page, 'lesson');
      assert.equal(await page.locator('[data-action="start-group-practice"]').getAttribute('type'), 'button');
      await assertNoHorizontalOverflow(page, `${viewport.label} practice entrance`);
      await assertVisibleTargetsAreLargeEnough(page, `${viewport.label} practice entrance`);
      await assertTextIsNotClipped(page, [
        '[data-view="lesson"] [data-view-heading]',
        '.lesson-practice-summary',
        '[data-action="start-group-practice"]'
      ], `${viewport.label} practice entrance`);
      const compactLandscape = viewport.width > viewport.height && viewport.height <= 760;
      await assertInlineContentInset(
        page,
        '.lesson-practice-summary',
        compactLandscape ? 6 : 12,
        `${viewport.label} practice entrance summary`
      );
      await assertVerticalGap(
        page,
        '[data-view="lesson"] .segmented-control',
        '.lesson-practice-summary',
        compactLandscape ? 4 : 12,
        `${viewport.label} practice entrance controls`
      );
      await assertSelectorsDoNotOverlap(page, [
        '[data-view="lesson"] .back-button',
        '[data-view="lesson"] .view-eyebrow',
        '[data-view="lesson"] [data-view-heading]',
        '[data-view="lesson"] .segmented-control',
        '.lesson-practice-summary'
      ], `${viewport.label} practice entrance header`);
      await assertSelectorsDoNotOverlap(page, [
        '.lesson-heading',
        '.lesson-start',
        '.character-grid'
      ], `${viewport.label} practice entrance content`);
      await capturePracticeScreenshot(page, artifactPath, viewport, 'entrance');

      await page.goto(withHash(
        indexUrl,
        practiceHash('g4f-02', 'write', 'single', PRACTICE_CHARACTER)
      ), { waitUntil: 'load' });
      await waitForPractice(page, '引导描写');
      await assertPracticeActiveGeometry(page, viewport, '引导描写', `${viewport.label} guided`);
      if (viewport.width < 760 && viewport.height > viewport.width) {
        const portraitLayout = await page.evaluate(() => {
          const board = document.querySelector('.practice-board').getBoundingClientRect();
          const tools = document.querySelector('.practice-tools').getBoundingClientRect();
          const navigation = document.querySelector('.practice-navigation').getBoundingClientRect();
          return {
            lessonDisplay: getComputedStyle(
              document.querySelector('.practice-lesson-title')
            ).display,
            groupDisplay: getComputedStyle(
              document.querySelector('.practice-group-label')
            ).display,
            workSurfaceBottom: Math.max(board.bottom, tools.bottom),
            navigationTop: navigation.top
          };
        });
        assert.equal(portraitLayout.lessonDisplay, 'none');
        assert.equal(portraitLayout.groupDisplay, 'none');
        assert.ok(
          portraitLayout.navigationTop >= portraitLayout.workSurfaceBottom - 1,
          `${viewport.label}: portrait practice navigation is not below the work surface ${JSON.stringify(portraitLayout)}`
        );
      }
      await capturePracticeScreenshot(page, artifactPath, viewport, 'guided');

      await drawPracticeCharacter(page);
      await waitForPractice(page, '独立描写');
      await assertPracticeActiveGeometry(page, viewport, '独立描写', `${viewport.label} independent`);
      await capturePracticeScreenshot(page, artifactPath, viewport, 'independent');

      const boardBeforeError = await page.locator('[data-slot="practice-board"]').boundingBox();
      assert.ok(boardBeforeError, `${viewport.label}: board disappeared before error feedback`);
      await drawPracticeMedian(page, 0, { reverse: true });
      const errorFeedback = page.locator('[data-slot="practice-feedback"][data-kind="error"]');
      await errorFeedback.filter({ hasText: '方向反了' }).waitFor();
      const boardAfterError = await page.locator('[data-slot="practice-board"]').boundingBox();
      assert.ok(boardAfterError, `${viewport.label}: board disappeared after error feedback`);
      for (const field of ['x', 'y', 'width', 'height']) {
        assert.ok(
          Math.abs(boardBeforeError[field] - boardAfterError[field]) <= 1,
          `${viewport.label}: error feedback shifted board ${JSON.stringify({ boardBeforeError, boardAfterError })}`
        );
      }
      await assertTextIsNotClipped(page, [
        '[data-slot="practice-feedback"]'
      ], `${viewport.label} independent error feedback`);
      await drawPracticeCharacter(page);
      await page.locator('.practice-retry-result').waitFor();
      await assertPracticeCommon(page, `${viewport.label} needs retry`);
      await assertTextIsNotClipped(page, [
        '.practice-retry-result',
        '.practice-retry-result .practice-actions'
      ], `${viewport.label} needs retry`);
      await assertSelectorsDoNotOverlap(page, [
        '[data-view-heading]',
        '.practice-retry-result'
      ], `${viewport.label} needs retry content`);
      await assertSelectorsDoNotOverlap(page, [
        '.practice-retry-result > h2',
        '.practice-retry-result > p',
        '.practice-retry-result > .practice-actions'
      ], `${viewport.label} needs retry details`);
      await assertPracticeResultActions(
        page,
        '.practice-retry-result',
        `${viewport.label} needs retry`
      );
      await capturePracticeScreenshot(page, artifactPath, viewport, 'needs-retry');

      await page.locator('[data-action="practice-retry"]').click();
      await waitForPractice(page, '独立描写');
      await drawPracticeCharacter(page);
      await page.locator('.practice-complete-result').waitFor();
      await assertPracticeCommon(page, `${viewport.label} complete`);
      await assertTextIsNotClipped(page, [
        '.practice-complete-result',
        '.practice-complete-result .practice-actions'
      ], `${viewport.label} complete`);
      await assertSelectorsDoNotOverlap(page, [
        '[data-view-heading]',
        '.practice-complete-result'
      ], `${viewport.label} complete content`);
      await assertSelectorsDoNotOverlap(page, [
        '.practice-complete-result > h2',
        '.practice-complete-result > p:nth-of-type(1)',
        '.practice-complete-result > p:nth-of-type(2)',
        '.practice-complete-result > p:nth-of-type(3)',
        '.practice-complete-result > p:nth-of-type(4)',
        '.practice-complete-result > .practice-actions'
      ], `${viewport.label} complete details`);
      await assertPracticeResultActions(
        page,
        '.practice-complete-result',
        `${viewport.label} complete`
      );
      assert.match(await page.locator('.practice-complete-result').textContent(), /本轮练习完成/);
      await capturePracticeScreenshot(page, artifactPath, viewport, 'complete');
    });
  }

  test('practice supports keyboard, reduced motion, trusted multi-touch cancellation and scroll boundaries', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ viewport: { width: 360, height: 800 }, reducedMotion: true });
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await page.addInitScript(() => {
      window.__practicePointerTrust = [];
      document.addEventListener('pointerdown', (event) => {
        window.__practicePointerTrust.push({ isPrimary: event.isPrimary, isTrusted: event.isTrusted });
      }, true);
    });
    await page.goto(withHash(
      indexUrl,
      practiceHash('g4f-02', 'write', 'single', PRACTICE_CHARACTER)
    ), { waitUntil: 'load' });
    await waitForPractice(page, '引导描写');

    const board = page.locator('[data-slot="practice-board"]');
    assert.equal(await board.getAttribute('role'), 'img');
    assert.match(await board.getAttribute('aria-label'), /砂.*引导描写.*第1笔/);
    const hint = page.locator('[data-action="practice-hint"]');
    assert.equal(await hint.evaluate((button) => button.tagName), 'BUTTON');
    assert.equal(await hint.getAttribute('type'), 'button');
    assert.equal(await hint.getAttribute('aria-label'), '提示当前笔');
    assert.equal(await page.locator('[data-slot="practice-feedback"]').getAttribute('aria-live'), 'polite');
    await hint.focus();
    await hint.press('Enter');
    await page.locator('[data-slot="practice-feedback"][data-kind="hint"]')
      .filter({ hasText: '请看当前笔的提示' }).waitFor();
    const focusOutline = await hint.evaluate((button) => getComputedStyle(button).outlineStyle);
    assert.notEqual(focusOutline, 'none');
    const restart = page.locator('[data-action="practice-restart"]');
    await restart.focus();
    await restart.press('Space');
    await page.locator('[data-slot="practice-feedback"]')
      .filter({ hasText: '已经重新开始' }).waitFor();

    await board.scrollIntoViewIfNeeded();
    await drawPracticeMedian(page, 0, { reverse: true });
    const errorFeedback = page.locator('[data-slot="practice-feedback"][data-kind="error"]');
    await errorFeedback.filter({ hasText: '方向反了' }).waitFor();
    assert.match(await errorFeedback.textContent(), /方向反了.*再试一次/);
    assert.equal(await page.locator('.practice-error-path').count(), 0,
      'reduced motion should remove the transient error animation');
    await restart.press('Space');
    await page.locator('[data-slot="practice-feedback"]')
      .filter({ hasText: '已经重新开始' }).waitFor();

    await board.scrollIntoViewIfNeeded();
    const boardBox = await board.boundingBox();
    assert.ok(boardBox, 'practice board has no touch geometry');
    const boardScrollBefore = await page.evaluate(() => window.scrollY);
    await dispatchTouchGesture(client, [
      { x: boardBox.x + (boardBox.width * 0.75), y: boardBox.y + (boardBox.height * 0.75) },
      { x: boardBox.x + (boardBox.width * 0.75), y: boardBox.y + (boardBox.height * 0.35) }
    ], 2);
    const boardScrollSamples = await observeScrollPosition(page);
    assert.equal(boardScrollSamples.length > 5, true, 'expected multiple post-touch scroll samples');
    assert.equal(
      boardScrollSamples.every((scrollY) => Math.abs(scrollY - boardScrollBefore) <= 1),
      true,
      `drawing surface scrolled the page: ${JSON.stringify({ boardScrollBefore, boardScrollSamples })}`
    );
    await restart.click();

    await page.evaluate(() => window.scrollTo(0, 0));
    const scrollExtent = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    assert.ok(scrollExtent > 100, `practice page is not scrollable: ${scrollExtent}`);
    await dispatchTouchGesture(client, [
      { x: 4, y: 720 },
      { x: 4, y: 520 },
      { x: 4, y: 240 }
    ], 3);
    await page.waitForFunction(() => window.scrollY > 20);
    assert.ok(await page.evaluate(() => window.scrollY) > 20, 'non-board content did not scroll');

    await page.reload({ waitUntil: 'load' });
    await waitForPractice(page, '引导描写');
    await page.locator('[data-slot="practice-board"]').scrollIntoViewIfNeeded();
    await drawPracticeCharacterWithTouch(client, page);
    await waitForPractice(page, '独立描写');
    const firstStroke = await mappedPracticeMedian(page, 0);
    const first = trustedTouchPoint(firstStroke[0], 10);
    const middle = trustedTouchPoint(firstStroke[Math.floor(firstStroke.length / 2)], 10);
    const second = trustedTouchPoint({ x: first.x + 24, y: first.y + 24 }, 11);
    const continued = trustedTouchPoint(firstStroke.at(-1), 10);
    const secondMoved = trustedTouchPoint({ x: second.x + 18, y: second.y + 12 }, 11);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, second] });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [continued, secondMoved]
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [continued] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [continued] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.locator('[data-slot="practice-board"][aria-busy="false"]').waitFor();
    assert.equal(await page.locator('[data-slot="practice-stroke-position"]').textContent(), '第 1 / 9 笔');
    assert.notEqual(await page.locator('[data-slot="practice-feedback"]').getAttribute('data-kind'), 'error');
    await dispatchTouchGesture(client, firstStroke, 12);
    await waitForPracticeStroke(page, 2, 9);
    assert.notEqual(await page.locator('[data-slot="practice-feedback"]').getAttribute('data-kind'), 'error');
    for (let index = 1; index < 9; index += 1) {
      await dispatchTouchGesture(client, await mappedPracticeMedian(page, index), index + 20);
      if (index < 8) await waitForPracticeStroke(page, index + 2, 9);
    }
    await page.locator('.practice-complete-result').waitFor();
    assert.equal(await page.locator('.practice-retry-result').count(), 0,
      'the canceled two-pointer stroke must not count as a mistake');
    const trust = await page.evaluate(() => window.__practicePointerTrust);
    assert.ok(trust.length >= 2, `expected trusted pointer events: ${JSON.stringify(trust)}`);
    assert.equal(trust.every((event) => event.isTrusted === true), true, JSON.stringify(trust));
    assert.equal(trust.some((event) => event.isPrimary === false), true, JSON.stringify(trust));
    await client.detach();
  });
}
