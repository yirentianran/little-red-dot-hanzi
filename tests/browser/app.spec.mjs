import assert from 'node:assert/strict';

const LAST_ROUTE_KEY = 'hanzi-tracking:last-route:v1';

function lessonHash(lessonId, group) {
  const parameters = new URLSearchParams({ lesson: lessonId, group });
  return `#/lesson?${parameters}`;
}

function characterHash(lessonId, group, character) {
  const parameters = new URLSearchParams({ lesson: lessonId, group, character });
  return `#/character?${parameters}`;
}

function withHash(indexUrl, hash) {
  const url = new URL(indexUrl);
  url.hash = hash;
  return url.href;
}

async function waitForView(page, view) {
  await page.locator(`[data-view="${view}"]`).waitFor({ state: 'visible' });
}

async function waitForCharacter(page, character) {
  await waitForView(page, 'character');
  await page.locator('[data-view-heading]').filter({ hasText: `学习“${character}”` }).waitFor({
    state: 'visible'
  });
}

async function currentHash(page) {
  return page.evaluate(() => window.location.hash);
}

async function dotPosition(page) {
  return page.locator('[data-tracking-dot="core"]').evaluate((dot) => ({
    display: dot.getAttribute('display'),
    x: Number(dot.getAttribute('cx')),
    y: Number(dot.getAttribute('cy'))
  }));
}

async function waitForVisibleDot(page) {
  await page.waitForFunction(() => {
    const dot = document.querySelector('[data-tracking-dot="core"]');
    return dot
      && dot.getAttribute('display') !== 'none'
      && Number.isFinite(Number(dot.getAttribute('cx')))
      && Number.isFinite(Number(dot.getAttribute('cy')));
  });
}

async function waitForDotMovement(page, start, timeout = 3_000) {
  await page.waitForFunction(
    ({ startX, startY }) => {
      const dot = document.querySelector('[data-tracking-dot="core"]');
      if (!dot || dot.getAttribute('display') === 'none') return false;
      const x = Number(dot.getAttribute('cx'));
      const y = Number(dot.getAttribute('cy'));
      return Number.isFinite(x)
        && Number.isFinite(y)
        && Math.hypot(x - startX, y - startY) > 0.5;
    },
    { startX: start.x, startY: start.y },
    { timeout }
  );
}

async function waitForStatus(page, fragment, timeout = 10_000) {
  await page.waitForFunction(
    (expected) => document.querySelector('[data-slot="animation-status"]')
      ?.textContent.includes(expected),
    fragment,
    { timeout }
  );
}

async function measureFirstStrokeDuration(page, speed) {
  const speedButton = page.locator(`[data-action="set-speed"][data-speed="${speed}"]`);
  await speedButton.click();
  assert.equal(await speedButton.getAttribute('aria-pressed'), 'true');
  const startedAt = Date.now();
  await page.locator('[data-action="replay"]').click();
  await waitForStatus(page, '准备下一笔');
  const duration = Date.now() - startedAt;
  await page.locator('[data-action="toggle-play"]').click();
  await waitForStatus(page, '已暂停');
  return duration;
}

async function countRasterPixels(page) {
  return page.locator('[data-slot="character-board"] svg').evaluate(async (sourceSvg) => {
    const clone = sourceSvg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', '256');
    clone.setAttribute('height', '256');
    const markup = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([markup], { type: 'image/svg+xml' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = blobUrl;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonWhite = 0;
      let dark = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        if (red < 250 || green < 250 || blue < 250) nonWhite += 1;
        if (red < 80 && green < 80 && blue < 80) dark += 1;
      }
      return { nonWhite, dark };
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  });
}

export async function registerBrowserTests({ test }) {
  test('opens from file URL and repairs the empty route to canonical #/', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage();
    await page.goto(indexUrl, { waitUntil: 'load' });
    await waitForView(page, 'directory');

    const url = new URL(page.url());
    assert.equal(url.protocol, 'file:');
    assert.equal(await currentHash(page), '#/');
    assert.equal(await page.locator('[data-view-heading]').textContent(), '课程目录');
  });

  test('navigates lesson 1 write characters with canonical history and resumable storage', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage();
    await page.goto(indexUrl, { waitUntil: 'load' });
    await waitForView(page, 'directory');

    await page.locator(
      '[data-action="open-lesson"][data-lesson-id="lesson-1"][data-group="write"]'
    ).click();
    await waitForView(page, 'lesson');
    assert.equal(await currentHash(page), lessonHash('lesson-1', 'write'));
    assert.equal(await page.locator('[data-view-heading]').textContent(), '1  观潮');

    await page.locator(
      '.character-card[data-action="open-character"][data-lesson-id="lesson-1"]'
        + '[data-group="write"][data-character="潮"]'
    ).click();
    await waitForCharacter(page, '潮');
    assert.equal(await currentHash(page), characterHash('lesson-1', 'write', '潮'));
    assert.equal(await page.locator('.character-pinyin').textContent(), 'cháo');
    assert.equal(await page.locator('.character-display').textContent(), '潮');
    assert.equal(await page.locator('[data-slot="vocabulary-words"]').textContent(), '组词：潮水  浪潮  涨潮');
    assert.equal(await page.locator('.stroke-count').textContent(), '共 15 笔');
    assert.equal(await page.locator('[data-slot="character-board"] svg').count(), 1);

    for (const action of [
      'play-audio',
      'previous-stroke',
      'toggle-play',
      'replay',
      'next-stroke',
      'previous-character',
      'next-character'
    ]) {
      assert.equal(await page.locator(`[data-action="${action}"]`).count(), 1, action);
    }
    assert.deepEqual(
      await page.locator('[data-action="set-speed"]').evaluateAll((buttons) => (
        buttons.map((button) => button.getAttribute('data-speed'))
      )),
      ['slow', 'normal', 'fast']
    );

    await page.locator('[data-action="next-character"][data-character="据"]').click();
    await waitForCharacter(page, '据');
    const accordingHash = characterHash('lesson-1', 'write', '据');
    assert.equal(await currentHash(page), accordingHash);
    assert.equal(
      await page.evaluate((key) => window.localStorage.getItem(key), LAST_ROUTE_KEY),
      accordingHash
    );

    await page.goBack();
    await waitForCharacter(page, '潮');
    assert.equal(await currentHash(page), characterHash('lesson-1', 'write', '潮'));
    await page.goForward();
    await waitForCharacter(page, '据');
    assert.equal(await currentHash(page), accordingHash);

    await page.reload({ waitUntil: 'load' });
    await waitForCharacter(page, '据');
    assert.equal(await currentHash(page), accordingHash);

    await page.locator('[data-action="back-lesson"]').click();
    await waitForView(page, 'lesson');
    await page.locator('[data-action="go-directory"]').click();
    await waitForView(page, 'directory');
    const resume = page.locator('[data-action="resume-learning"]');
    await resume.waitFor({ state: 'visible' });
    await resume.click();
    await waitForCharacter(page, '据');
    assert.equal(await currentHash(page), accordingHash);
  });

  test('creates one real local Audio only after click and announces successful playback', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ instrumentAudio: true, reducedMotion: true });
    await page.goto(
      withHash(indexUrl, characterHash('lesson-1', 'write', '潮')),
      { waitUntil: 'load' }
    );
    await waitForCharacter(page, '潮');

    const before = await page.evaluate(() => window.__HANZI_AUDIO_PROBE__.snapshot());
    assert.equal(before.nativeAudio, true);
    assert.equal(before.records.length, 0);

    await page.locator('[data-action="play-audio"]').click();
    await page.waitForFunction(() => {
      const probe = window.__HANZI_AUDIO_PROBE__?.snapshot();
      return probe?.records.length === 1
        && (probe.records[0].readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          || probe.records[0].error !== null);
    });
    await page.waitForFunction(() => document.querySelector('#announcer')
      ?.textContent.includes('潮的读音已开始播放'));

    const after = await page.evaluate(() => window.__HANZI_AUDIO_PROBE__.snapshot());
    assert.equal(after.records.length, 1);
    assert.equal(after.records[0].src.startsWith('file:'), true);
    assert.match(after.records[0].src, /\/assets\/audio\/chao2\.mp3$/);
    assert.ok(after.records[0].readyState >= 2, JSON.stringify(after.records[0]));
    assert.equal(after.records[0].error, null);
    assert.deepEqual(after.records[0].errorEvents, []);
    assert.match(await page.locator('#announcer').textContent(), /潮的读音已开始播放/);
  });

  test('renders all 15 潮 ghost paths with usable geometry and non-white raster pixels', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ reducedMotion: true });
    await page.goto(
      withHash(indexUrl, characterHash('lesson-1', 'write', '潮')),
      { waitUntil: 'load' }
    );
    await waitForCharacter(page, '潮');

    const ghostPaths = page.locator('[data-slot="character-board"] .hanzi-stroke--ghost');
    assert.equal(await ghostPaths.count(), 15);
    const boxes = await ghostPaths.evaluateAll((paths) => paths.map((path) => {
      const box = path.getBBox();
      return { width: box.width, height: box.height };
    }));
    assert.equal(
      boxes.every((box) => box.width > 0 && box.height > 0),
      true,
      JSON.stringify(boxes)
    );

    const raster = await countRasterPixels(page);
    assert.ok(raster.nonWhite > 8_000, JSON.stringify(raster));
    assert.ok(raster.dark > 1_000, JSON.stringify(raster));
  });

  test('moves and pauses the tracking dot and supports replay, stroke stepping, and all speeds', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage();
    await page.goto(
      withHash(indexUrl, characterHash('lesson-1', 'write', '潮')),
      { waitUntil: 'load' }
    );
    await waitForCharacter(page, '潮');

    await waitForVisibleDot(page);
    const visibleStartCap = page.locator('.hanzi-stroke-start-cap[display="inline"]');
    assert.equal(await visibleStartCap.count(), 1);
    assert.equal(await visibleStartCap.getAttribute('fill'), '#20252b');
    assert.match(await visibleStartCap.getAttribute('clip-path'), /^url\(#hanzi-stroke-clip-/);
    const movingStart = await dotPosition(page);
    await waitForDotMovement(page, movingStart);

    await page.locator('[data-action="toggle-play"]').click();
    await waitForStatus(page, '已暂停');
    const paused = await dotPosition(page);
    await page.waitForTimeout(250);
    const stillPaused = await dotPosition(page);
    assert.ok(Math.hypot(stillPaused.x - paused.x, stillPaused.y - paused.y) < 0.01);

    for (const speed of ['slow', 'normal', 'fast']) {
      const button = page.locator(`[data-action="set-speed"][data-speed="${speed}"]`);
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
    }

    await page.locator('[data-action="next-stroke"]').click();
    await waitForStatus(page, '第 2 / 15 笔');
    await waitForStatus(page, '已暂停');
    await page.locator('[data-action="previous-stroke"]').click();
    await waitForStatus(page, '第 1 / 15 笔');
    await waitForStatus(page, '已暂停');

    await page.locator('[data-action="replay"]').click();
    await waitForStatus(page, '连续播放');
    await waitForVisibleDot(page);
    const replayStart = await dotPosition(page);
    await waitForDotMovement(page, replayStart);
  });

  test('orders all speeds and loops the three-stroke 亿 animation after completion', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage();
    await page.goto(
      withHash(indexUrl, characterHash('lesson-7', 'write', '亿')),
      { waitUntil: 'load' }
    );
    await waitForCharacter(page, '亿');
    assert.equal(await page.locator('.stroke-count').textContent(), '共 3 笔');
    assert.equal(await page.locator('.hanzi-stroke--ghost').count(), 3);

    const durationBySpeed = {
      slow: await measureFirstStrokeDuration(page, 'slow'),
      normal: await measureFirstStrokeDuration(page, 'normal'),
      fast: await measureFirstStrokeDuration(page, 'fast')
    };
    assert.ok(
      durationBySpeed.slow > durationBySpeed.normal * 1.15,
      JSON.stringify(durationBySpeed)
    );
    assert.ok(
      durationBySpeed.normal > durationBySpeed.fast * 1.15,
      JSON.stringify(durationBySpeed)
    );

    await page.locator('[data-action="replay"]').click();
    await waitForStatus(page, '书写完成', 12_000);
    assert.equal(
      await page.locator('.hanzi-stroke--completed[display="inline"]').count(),
      3
    );
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-slot="animation-status"]')?.textContent || '';
      const dot = document.querySelector('[data-tracking-dot="core"]');
      return status.includes('正在书写')
        && status.includes('第 1 / 3 笔')
        && dot?.getAttribute('display') !== 'none';
    }, null, { timeout: 4_000 });
  });

  test('reduced motion starts idle with the full glyph and moves only through manual controls', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ reducedMotion: true });
    await page.goto(
      withHash(indexUrl, characterHash('lesson-1', 'write', '潮')),
      { waitUntil: 'load' }
    );
    await waitForCharacter(page, '潮');
    await waitForStatus(page, '准备开始');
    const initialStatus = await page.locator('[data-slot="animation-status"]').textContent();
    await page.waitForTimeout(500);
    assert.equal(
      await page.locator('[data-slot="animation-status"]').textContent(),
      initialStatus
    );
    assert.equal(
      await page.locator('.hanzi-stroke--completed[display="inline"]').count(),
      15
    );
    assert.equal(
      await page.locator('[data-tracking-dot="core"]').getAttribute('display'),
      'none'
    );

    await page.locator('[data-action="next-stroke"]').click();
    await waitForStatus(page, '第 2 / 15 笔');
    await waitForVisibleDot(page);
    await waitForStatus(page, '已暂停');
    await page.locator('[data-action="previous-stroke"]').click();
    await waitForStatus(page, '第 1 / 15 笔');
  });
}
