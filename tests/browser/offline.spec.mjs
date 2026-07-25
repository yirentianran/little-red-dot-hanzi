import assert from 'node:assert/strict';
import path from 'node:path';

const VIEWPORTS = Object.freeze([
  Object.freeze({ width: 360, height: 800, label: '360x800' }),
  Object.freeze({ width: 768, height: 1024, label: '768x1024' }),
  Object.freeze({ width: 1440, height: 900, label: '1440x900' })
]);

function lessonHash(lessonId, group) {
  return `#/lesson?${new URLSearchParams({ lesson: lessonId, group })}`;
}

function characterHash(lessonId, group, character) {
  return `#/character?${new URLSearchParams({ lesson: lessonId, group, character })}`;
}

function withHash(indexUrl, hash) {
  const url = new URL(indexUrl);
  url.hash = hash;
  return url.href;
}

async function waitForView(page, view) {
  await page.locator(`[data-view="${view}"]`).waitFor({ state: 'visible' });
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
}
