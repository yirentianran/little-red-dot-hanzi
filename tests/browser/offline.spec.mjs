import assert from 'node:assert/strict';
import path from 'node:path';

const VIEWPORTS = Object.freeze([
  Object.freeze({ width: 360, height: 800, label: '360x800' }),
  Object.freeze({ width: 768, height: 1024, label: '768x1024' }),
  Object.freeze({ width: 1440, height: 900, label: '1440x900' })
]);

const PRACTICE_CHARACTER = '肃';
const PRACTICE_PADDING = 24;

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
    const board = document.querySelector('[data-slot="practice-board"]');
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
  assert.equal(await page.locator('[data-view-heading]').textContent(), '课程目录');
  assert.equal(await page.locator(
    '[data-action="open-lesson"][data-lesson-id="lesson-22"]'
  ).count(), 1);
  await assertSelectorsDoNotOverlap(page, [
    '[data-view="directory"] [data-view-heading]',
    '[data-view="directory"] [data-unit-band="unit-1"]'
  ], label);
}

async function assertLessonGeometry(page, label) {
  assert.equal(await page.locator('[data-view-heading]').textContent(), '22  为中华之崛起而读书');
  assert.equal(
    await page.locator('[data-action="select-group"][data-group="write"]')
      .getAttribute('aria-pressed'),
    'true'
  );
  assert.equal(await page.locator(
    '[data-action="open-character"][data-character="肃"]'
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
  assert.equal(await page.locator('[data-view-heading]').textContent(), '学习“肃”');
  assert.equal(await page.locator('.character-pinyin').textContent(), 'sù');
  assert.match(await page.locator('[data-action="back-lesson"]').textContent(), /为中华之崛起而读书/);

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
    return {
      board: box('[data-slot="character-board"]'),
      tools: box('.character-tools')
    };
  });
  assert.equal(intersects(layout.board, layout.tools), false, `${label}: board and tools overlap`);
  if (viewport.width < 760) {
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
}

async function assertPracticeActiveGeometry(page, viewport, phase, label) {
  await assertPracticeCommon(page, label);
  const board = page.locator('[data-slot="practice-board"]');
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
  if (viewport.width < 760) {
    assert.ok(geometry.board.bottom <= geometry.tools.top + 1,
      `${label}: mobile practice surface is not stacked ${JSON.stringify(geometry)}`);
  } else {
    assert.ok(geometry.board.right <= geometry.tools.left + 1,
      `${label}: desktop practice surface is not two columns ${JSON.stringify(geometry)}`);
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
    new RegExp(`${PRACTICE_CHARACTER}.*${phase}.*\u7b2c1\u7b14.*\u51718\u7b14`)
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
        withHash(indexUrl, lessonHash('lesson-22', 'write')),
        { waitUntil: 'load' }
      );
      await waitForView(page, 'lesson');
      await assertNoHorizontalOverflow(page, `${viewport.label} lesson`);
      await assertVisibleTargetsAreLargeEnough(page, `${viewport.label} lesson`);
      await assertLessonGeometry(page, `${viewport.label} lesson`);
      await saveFullPageScreenshot(
        page,
        artifactPath(`${viewport.label}-lesson-22-write.png`),
        `${viewport.label} lesson`
      );

      await page.goto(
        withHash(indexUrl, characterHash('lesson-22', 'write', '肃')),
        { waitUntil: 'load' }
      );
      await waitForView(page, 'character');
      await assertNoHorizontalOverflow(page, `${viewport.label} character`);
      await assertVisibleTargetsAreLargeEnough(page, `${viewport.label} character`);
      await assertCharacterGeometry(page, viewport, `${viewport.label} character`);
      await saveFullPageScreenshot(
        page,
        artifactPath(`${viewport.label}-lesson-22-write-su.png`),
        `${viewport.label} character`
      );
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`practice responsive states at ${viewport.label}`, async ({
      indexUrl,
      openPage,
      artifactPath
    }) => {
      const page = await openPage({ viewport, reducedMotion: true });
      await page.goto(withHash(indexUrl, lessonHash('lesson-22', 'write')), { waitUntil: 'load' });
      await waitForView(page, 'lesson');
      assert.equal(await page.locator('[data-action="start-group-practice"]').getAttribute('type'), 'button');
      await assertNoHorizontalOverflow(page, `${viewport.label} practice entrance`);
      await assertVisibleTargetsAreLargeEnough(page, `${viewport.label} practice entrance`);
      await assertTextIsNotClipped(page, [
        '[data-view="lesson"] [data-view-heading]',
        '.lesson-practice-summary',
        '[data-action="start-group-practice"]'
      ], `${viewport.label} practice entrance`);
      await assertInlineContentInset(
        page,
        '.lesson-practice-summary',
        12,
        `${viewport.label} practice entrance summary`
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
        practiceHash('lesson-22', 'write', 'single', PRACTICE_CHARACTER)
      ), { waitUntil: 'load' });
      await waitForPractice(page, '引导描写');
      await assertPracticeActiveGeometry(page, viewport, '引导描写', `${viewport.label} guided`);
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
      practiceHash('lesson-22', 'write', 'single', PRACTICE_CHARACTER)
    ), { waitUntil: 'load' });
    await waitForPractice(page, '引导描写');

    const board = page.locator('[data-slot="practice-board"]');
    assert.equal(await board.getAttribute('role'), 'img');
    assert.match(await board.getAttribute('aria-label'), /肃.*引导描写.*第1笔/);
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
    assert.equal(await page.locator('[data-slot="practice-stroke-position"]').textContent(), '第 1 / 8 笔');
    assert.notEqual(await page.locator('[data-slot="practice-feedback"]').getAttribute('data-kind'), 'error');
    await dispatchTouchGesture(client, firstStroke, 12);
    await waitForPracticeStroke(page, 2, 8);
    assert.notEqual(await page.locator('[data-slot="practice-feedback"]').getAttribute('data-kind'), 'error');
    for (let index = 1; index < 8; index += 1) {
      await dispatchTouchGesture(client, await mappedPracticeMedian(page, index), index + 20);
      if (index < 7) await waitForPracticeStroke(page, index + 2, 8);
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
