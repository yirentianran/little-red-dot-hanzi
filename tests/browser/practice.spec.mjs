import assert from 'node:assert/strict';

const PRACTICE_STORAGE_KEY = 'hanzi-tracking:practice-progress:v2';
const PADDING = 0;

const LESSON_ONE_RECOGNIZE = Object.freeze([
  '盐', '薄', '屹', '昂', '顿', '鼎', '沸', '贯', '浩', '崩', '震', '霎', '余'
]);

function practiceHash(lessonId, group, scope, character) {
  return `#/practice?${new URLSearchParams({ lesson: lessonId, group, scope, character })}`;
}

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

async function waitForPractice(page, character, phase) {
  await page.locator('[data-view="practice"]').waitFor({ state: 'visible' });
  await page.locator('[data-view-heading]').filter({ hasText: `练习“${character}”` }).waitFor();
  if (phase) await page.locator('.practice-phase').filter({ hasText: phase }).waitFor();
  await page.locator('[data-slot="practice-board"] .practice-writer-host svg').waitFor();
  await page.locator('[data-slot="practice-board"][aria-busy="false"]').waitFor();
}

async function currentCharacter(page) {
  return page.locator('[data-view-heading]').textContent().then((text) => {
    const match = /练习“(.)”/u.exec(text || '');
    assert.ok(match, `unexpected practice heading: ${text}`);
    return match[1];
  });
}

async function mappedMedian(page, character, strokeIndex, options = {}) {
  const { reverse = false, jitter = 0, offsetX = 0, offsetY = 0, short = false } = options;
  const points = await page.evaluate(({ character: hanzi, strokeIndex: index, padding }) => {
    const board = document.querySelector('[data-slot="practice-board"] .practice-writer-host');
    const geometry = window.HANZI_LIBRARY.characters[hanzi];
    if (!board || !geometry) throw new Error(`missing practice geometry for ${hanzi}`);
    const box = board.getBoundingClientRect();
    const transform = window.HanziWriter.getScalingTransform(box.width, box.height, padding);
    return geometry.medians[index].map(([x, y]) => ({
      x: box.left + transform.x + (x * transform.scale),
      y: box.top + box.height - transform.y - (y * transform.scale)
    }));
  }, { character, strokeIndex, padding: PADDING });

  let mapped = points.map((point, index) => ({
    x: point.x + offsetX + (jitter === 0 ? 0 : (index % 2 === 0 ? jitter : -jitter)),
    y: point.y + offsetY + (jitter === 0 ? 0 : (index % 3 === 0 ? -jitter : jitter))
  }));
  if (short) {
    const start = mapped[0];
    const next = mapped[1] || { x: start.x + 1, y: start.y };
    mapped = [start, {
      x: start.x + ((next.x - start.x) * 0.08),
      y: start.y + ((next.y - start.y) * 0.08)
    }];
  }
  if (reverse) mapped.reverse();
  return mapped;
}

async function drawPoints(page, points) {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 3 });
  }
  await page.mouse.up();
}

async function drawMedian(page, character, strokeIndex, options) {
  await drawPoints(page, await mappedMedian(page, character, strokeIndex, options));
}

async function drawTouchMedian(client, page, character, strokeIndex) {
  const points = await mappedMedian(page, character, strokeIndex);
  const touchPoint = (point) => ({
    x: point.x,
    y: point.y,
    id: 1,
    radiusX: 4,
    radiusY: 4,
    force: 0.5
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [touchPoint(points[0])]
  });
  for (const point of points.slice(1)) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [touchPoint(point)]
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function waitForStroke(page, current, total) {
  await page.locator('[data-slot="practice-stroke-position"]')
    .filter({ hasText: `第 ${current} / ${total} 笔` }).waitFor();
}

async function drawCharacter(page, character, { jitterStroke = -1 } = {}) {
  const strokeCount = await page.evaluate((hanzi) => (
    window.HANZI_LIBRARY.characters[hanzi].strokeCount
  ), character);
  for (let index = 0; index < strokeCount; index += 1) {
    await drawMedian(page, character, index, index === jitterStroke ? { jitter: 2 } : undefined);
    if (index + 1 < strokeCount) await waitForStroke(page, index + 2, strokeCount);
  }
  return strokeCount;
}

async function drawTouchCharacter(client, page, character) {
  const strokeCount = await page.evaluate((hanzi) => (
    window.HANZI_LIBRARY.characters[hanzi].strokeCount
  ), character);
  for (let index = 0; index < strokeCount; index += 1) {
    await drawTouchMedian(client, page, character, index);
    if (index + 1 < strokeCount) await waitForStroke(page, index + 2, strokeCount);
  }
}

async function restartPractice(page) {
  await page.locator('[data-action="practice-restart"]').click();
  await page.locator('[data-slot="practice-feedback"]')
    .filter({ hasText: '已经重新开始' }).waitFor();
  await waitForStroke(page, 1, Number(await page.locator('.practice-progress').getAttribute('max')));
  await page.locator('[data-slot="practice-board"][aria-busy="false"]').waitFor();
}

async function expectRejected(page, character, strokeIndex, options) {
  const before = await page.locator('[data-slot="practice-stroke-position"]').textContent();
  await drawMedian(page, character, strokeIndex, options);
  const feedback = page.locator('[data-slot="practice-feedback"][data-kind="error"]');
  await feedback.waitFor();
  assert.match(await feedback.textContent(), /不对|方向反了/);
  assert.equal(await page.locator('[data-slot="practice-stroke-position"]').textContent(), before);
}

function recognizeTailState() {
  const completed = LESSON_ONE_RECOGNIZE.slice(2);
  const characters = Object.fromEntries(completed.map((character) => [character, {
    attemptCount: 1,
    lastOutcome: 'mastered',
    mastered: true
  }]));
  return {
    schemaVersion: 2,
    characters,
    groups: {
      'lesson-1:recognize': {
        completedCharacters: completed,
        roundCharacters: LESSON_ONE_RECOGNIZE.slice(),
        roundCompletedCharacters: completed,
        remainingCharacters: ['盐', '薄'],
        needsPracticeCharacters: [],
        roundInitialMasteredCharacters: completed,
        roundNewlyMasteredCharacters: [],
        currentCharacter: '盐',
        currentPhase: 'guided'
      }
    }
  };
}

async function seedRecognizeTail(page) {
  await page.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }, {
    key: PRACTICE_STORAGE_KEY,
    value: JSON.stringify(recognizeTailState())
  });
}

async function installDocumentListenerProbe(page) {
  await page.addInitScript(() => {
    const tracked = new Map();
    const originalAdd = Document.prototype.addEventListener;
    const originalRemove = Document.prototype.removeEventListener;
    Document.prototype.addEventListener = function (type, callback, options) {
      let listeners = tracked.get(type);
      if (!listeners) tracked.set(type, listeners = new Set());
      listeners.add(callback);
      return originalAdd.call(this, type, callback, options);
    };
    Document.prototype.removeEventListener = function (type, callback, options) {
      tracked.get(type)?.delete(callback);
      return originalRemove.call(this, type, callback, options);
    };
    window.__documentListenerCount = () => [...tracked.values()]
      .reduce((total, listeners) => total + listeners.size, 0);
  });
}

export async function registerBrowserTests({ test }) {
  test('starts group and character practice from write and recognize views and returns to each origin', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ reducedMotion: true, viewport: { width: 900, height: 820 } });
    const groupEntries = [
      { group: 'write', character: '潮' },
      { group: 'recognize', character: '盐' }
    ];
    for (const entry of groupEntries) {
      const origin = lessonHash('lesson-1', entry.group);
      await page.goto(withHash(indexUrl, origin));
      await page.locator('[data-view="lesson"]').waitFor();
      await page.locator('[data-action="start-group-practice"]').click();
      await waitForPractice(page, entry.character, '引导描写');
      assert.equal(new URL(page.url()).hash, practiceHash(
        'lesson-1', entry.group, 'group', entry.character
      ));
      await page.locator('[data-action="practice-back"]').click();
      await page.locator('[data-view="lesson"]').waitFor();
      assert.equal(new URL(page.url()).hash, origin);
    }

    const characterEntries = [
      { group: 'write', character: '潮' },
      { group: 'recognize', character: '盐' }
    ];
    for (const entry of characterEntries) {
      const origin = characterHash('lesson-1', entry.group, entry.character);
      await page.goto(withHash(indexUrl, origin));
      await page.locator('[data-view="character"]').waitFor();
      await page.locator('[data-action="start-character-practice"]').click();
      await waitForPractice(page, entry.character, '引导描写');
      assert.equal(new URL(page.url()).hash, practiceHash(
        'lesson-1', entry.group, 'single', entry.character
      ));
      await page.locator('[data-action="practice-back"]').click();
      await page.locator('[data-view="character"]').waitFor();
      assert.equal(new URL(page.url()).hash, origin);
    }
  });

  test('practices a 16-stroke recognize character through guided and independent rounds', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ reducedMotion: true, viewport: { width: 1180, height: 900 } });
    await page.goto(withHash(indexUrl, practiceHash('lesson-1', 'recognize', 'single', '薄')));
    await waitForPractice(page, '薄', '引导描写');

    const oldSvg = await page.locator('.practice-writer-host svg').evaluate((svg) => {
      window.__guidedPracticeSvg = svg;
      return svg.isConnected;
    });
    assert.equal(oldSvg, true);
    await drawMedian(page, '薄', 0);
    await waitForStroke(page, 2, 16);
    assert.equal(await page.locator('.practice-progress').getAttribute('value'), '1');
    assert.match(await page.locator('[data-slot="practice-feedback"]').textContent(), /写对了/);
    for (let index = 1; index < 16; index += 1) {
      await drawMedian(page, '薄', index);
      if (index < 15) await waitForStroke(page, index + 2, 16);
    }

    await waitForPractice(page, '薄', '独立描写');
    assert.equal(await page.evaluate(() => window.__guidedPracticeSvg.isConnected), false);
    assert.equal(await page.locator('.practice-writer-host svg').count(), 1);
    await drawCharacter(page, '薄', { jitterStroke: 8 });
    await page.locator('.practice-complete-result').waitFor();
    assert.match(await page.locator('.practice-complete-result').textContent(), /当前掌握 1 个/);

    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), PRACTICE_STORAGE_KEY);
    assert.equal(saved.schemaVersion, 2);
    assert.deepEqual(saved.characters['薄'], {
      attemptCount: 1,
      lastOutcome: 'mastered',
      mastered: true
    });
  });

  test('rejects backwards and offset strokes and exposes hint feedback after two misses', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ viewport: { width: 900, height: 820 } });
    await page.goto(withHash(indexUrl, practiceHash('lesson-12', 'write', 'single', '丈')));
    await waitForPractice(page, '丈', '引导描写');

    await expectRejected(page, '丈', 0, { reverse: true });
    assert.match(await page.locator('[data-slot="practice-feedback"]').textContent(), /方向反了/);
    await restartPractice(page);
    await expectRejected(page, '丈', 0, { offsetY: 150 });
    await restartPractice(page);

    const baselineVisible = await page.locator('.practice-writer-host svg path').evaluateAll((paths) => (
      paths.filter((path) => getComputedStyle(path).opacity !== '0'
        && getComputedStyle(path).visibility !== 'hidden').length
    ));
    await expectRejected(page, '丈', 0, { short: true });
    await expectRejected(page, '丈', 0, { short: true });
    await page.waitForFunction((baseline) => {
      const paths = [...document.querySelectorAll('.practice-writer-host svg path')];
      return paths.filter((path) => getComputedStyle(path).opacity !== '0'
        && getComputedStyle(path).visibility !== 'hidden').length > baseline;
    }, baselineVisible);
    await page.locator('[data-action="practice-hint"]').click();
    await page.locator('[data-slot="practice-feedback"][data-kind="hint"]')
      .filter({ hasText: '请看当前笔的提示' }).waitFor();
  });

  test('retries an actual failed independent round and then masters the character', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ reducedMotion: true, viewport: { width: 900, height: 820 } });
    await page.goto(withHash(indexUrl, practiceHash('lesson-12', 'write', 'single', '丈')));
    await waitForPractice(page, '丈', '引导描写');
    await drawCharacter(page, '丈');
    await waitForPractice(page, '丈', '独立描写');
    await expectRejected(page, '丈', 0, { offsetY: 150 });
    await drawCharacter(page, '丈');
    await page.locator('.practice-retry-result').waitFor();
    await page.locator('[data-action="practice-retry"]').click();
    await waitForPractice(page, '丈', '独立描写');
    await waitForStroke(page, 1, 3);
    await drawCharacter(page, '丈');
    await page.locator('.practice-complete-result').waitFor();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), PRACTICE_STORAGE_KEY);
    assert.deepEqual(saved.characters['丈'], {
      attemptCount: 2,
      lastOutcome: 'mastered',
      mastered: true
    });
  });

  test('defers a failed group character and reviews only the needs-practice subset', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ reducedMotion: true, viewport: { width: 900, height: 820 } });
    await seedRecognizeTail(page);
    await page.goto(withHash(indexUrl, practiceHash('lesson-1', 'recognize', 'group', '盐')));
    await waitForPractice(page, '盐', '引导描写');
    await drawCharacter(page, '盐');
    await waitForPractice(page, '盐', '独立描写');
    await page.locator('.practice-writer-host svg').evaluate((svg) => { window.__saltWriterSvg = svg; });
    await expectRejected(page, '盐', 0, { offsetX: 150 });
    await drawCharacter(page, '盐');
    await page.locator('.practice-retry-result').waitFor();
    assert.match(await page.locator('.practice-retry-result').textContent(), /本次出现 1 次/);
    await page.locator('[data-action="practice-defer"]').click();
    await waitForPractice(page, '薄', '引导描写');
    assert.equal(await page.evaluate(() => window.__saltWriterSvg.isConnected), false);
    assert.equal(await page.locator('.practice-writer-host svg').count(), 1);
    await drawCharacter(page, '薄');
    await waitForPractice(page, '薄', '独立描写');
    await drawCharacter(page, '薄');
    await page.locator('.practice-complete-result').waitFor();
    assert.match(await page.locator('.practice-complete-result').textContent(), /需要再练 1 个/);

    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), PRACTICE_STORAGE_KEY);
    assert.equal(saved.schemaVersion, 2);
    assert.equal(saved.characters['盐'].lastOutcome, 'needs-practice');
    assert.deepEqual(saved.groups['lesson-1:recognize'].needsPracticeCharacters, ['盐']);

    await page.locator('[data-action="practice-review-needs"]').click();
    await waitForPractice(page, '盐', '引导描写');
    assert.equal(await page.locator('[data-slot="practice-round-position"]').textContent(), '第 1 / 1 个');
    assert.equal(await currentCharacter(page), '盐');
    assert.equal(new URL(page.url()).hash, practiceHash('lesson-1', 'recognize', 'group', '盐'));
  });

  test('tears down writer DOM and document listeners and keeps resize alignment without restart', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ viewport: { width: 1180, height: 900 } });
    await installDocumentListenerProbe(page);
    await page.goto(withHash(indexUrl, lessonHash('lesson-1', 'recognize')));
    await page.locator('[data-view="lesson"]').waitFor();
    const baselineListeners = await page.evaluate(() => window.__documentListenerCount());
    await page.goto(withHash(indexUrl, practiceHash('lesson-1', 'recognize', 'single', '盐')));
    await waitForPractice(page, '盐', '引导描写');
    assert.ok(await page.evaluate(() => window.__documentListenerCount()) > baselineListeners);

    const busyPointerEvents = await page.locator('[data-slot="practice-board"]').evaluate((board) => {
      board.setAttribute('aria-busy', 'true');
      const pointerEvents = getComputedStyle(board).pointerEvents;
      board.setAttribute('aria-busy', 'false');
      return pointerEvents;
    });
    assert.equal(busyPointerEvents, 'none');

    await page.locator('.practice-writer-host').evaluate((host) => { host.dataset.resizeProbe = 'same'; });
    const before = await page.locator('[data-slot="practice-board"]').boundingBox();
    await page.setViewportSize({ width: 620, height: 860 });
    await page.waitForFunction((width) => {
      const board = document.querySelector('[data-slot="practice-board"] .practice-writer-host');
      return board && Math.abs(board.getBoundingClientRect().width - width) > 1;
    }, before.width);
    assert.equal(await page.locator('.practice-writer-host').getAttribute('data-resize-probe'), 'same');
    const alignment = await page.evaluate((padding) => {
      const board = document.querySelector('[data-slot="practice-board"] .practice-writer-host');
      const dot = document.querySelector('.practice-start-dot');
      const [x, y] = window.HANZI_LIBRARY.characters['盐'].medians[0][0];
      const box = board.getBoundingClientRect();
      const transform = window.HanziWriter.getScalingTransform(box.width, box.height, padding);
      const dotBox = dot.getBoundingClientRect();
      return {
        expectedX: box.left + transform.x + (x * transform.scale),
        expectedY: box.top + box.height - transform.y - (y * transform.scale),
        actualX: dotBox.left + (dotBox.width / 2),
        actualY: dotBox.top + (dotBox.height / 2)
      };
    }, PADDING);
    assert.ok(Math.abs(alignment.actualX - alignment.expectedX) <= 1.5, JSON.stringify(alignment));
    assert.ok(Math.abs(alignment.actualY - alignment.expectedY) <= 1.5, JSON.stringify(alignment));

    const firstPoint = (await mappedMedian(page, '盐', 0))[0];
    await page.mouse.move(firstPoint.x, firstPoint.y);
    await page.mouse.down();
    await page.locator('[data-action="practice-back"]').evaluate((button) => button.click());
    await page.locator('[data-view="character"]').waitFor();
    await page.mouse.up();
    assert.equal(await page.locator('.practice-writer-host').count(), 0);
    assert.equal(await page.locator('[data-slot="practice-board"] svg').count(), 0);
    assert.equal(await page.evaluate(() => window.__documentListenerCount()), baselineListeners);
  });

  test('reloads an independent group round and keeps one writer through history and rapid routes', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ reducedMotion: true, viewport: { width: 900, height: 820 } });
    await seedRecognizeTail(page);
    await installDocumentListenerProbe(page);
    const lessonUrl = withHash(indexUrl, lessonHash('lesson-1', 'recognize'));
    await page.goto(lessonUrl);
    await page.locator('[data-view="lesson"]').waitFor();
    const baselineListeners = await page.evaluate(() => window.__documentListenerCount());
    await page.locator('[data-action="start-group-practice"]').click();
    await waitForPractice(page, '盐', '引导描写');
    await drawCharacter(page, '盐');
    await waitForPractice(page, '盐', '独立描写');
    await waitForStroke(page, 1, 10);
    const activeListeners = await page.evaluate(() => window.__documentListenerCount());
    assert.ok(activeListeners > baselineListeners);

    await page.reload({ waitUntil: 'load' });
    await waitForPractice(page, '盐', '独立描写');
    await waitForStroke(page, 1, 10);
    assert.equal(await page.locator('.practice-writer-host').count(), 1);
    assert.equal(await page.locator('.practice-overlay').count(), 1);
    assert.equal(await page.evaluate(() => window.__documentListenerCount()), activeListeners);

    await page.goBack();
    await page.locator('[data-view="lesson"]').waitFor();
    assert.equal(await page.locator('.practice-writer-host').count(), 0);
    assert.equal(await page.evaluate(() => window.__documentListenerCount()), baselineListeners);
    await page.goForward();
    await waitForPractice(page, '盐', '独立描写');
    assert.equal(await page.evaluate(() => window.__documentListenerCount()), activeListeners);
    await page.locator('.practice-writer-host').evaluate((host) => { window.__historyWriterHost = host; });

    const finalHash = practiceHash('lesson-22', 'write', 'single', '肃');
    await page.evaluate(({ middle, final }) => {
      window.location.hash = middle;
      window.location.hash = '#/';
      window.location.hash = final;
    }, { middle: lessonHash('lesson-22', 'write'), final: finalHash });
    await waitForPractice(page, '肃', '引导描写');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(new URL(page.url()).hash, finalHash);
    assert.equal(await page.evaluate(() => window.__historyWriterHost.isConnected), false);
    assert.equal(await page.locator('.practice-writer-host').count(), 1);
    assert.equal(await page.locator('.practice-overlay').count(), 1);
    assert.equal(await page.evaluate(() => window.__documentListenerCount()), activeListeners);
    await page.locator('[data-action="practice-back"]').click();
    await page.locator('[data-view="character"]').waitFor();
    assert.equal(new URL(page.url()).hash, characterHash('lesson-22', 'write', '肃'));
  });

  test('completes a short character with trusted Chromium touch input', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ reducedMotion: true, viewport: { width: 900, height: 820 } });
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await page.goto(withHash(indexUrl, practiceHash('lesson-12', 'write', 'single', '丈')));
    await waitForPractice(page, '丈', '引导描写');
    await page.evaluate(() => {
      window.__practiceTouchTrusted = null;
      document.addEventListener('touchstart', (event) => {
        window.__practiceTouchTrusted = event.isTrusted;
      }, { capture: true, once: true });
    });
    await drawTouchCharacter(client, page, '丈');
    await waitForPractice(page, '丈', '独立描写');
    await drawTouchCharacter(client, page, '丈');
    await page.locator('.practice-complete-result').waitFor();
    assert.equal(await page.evaluate(() => window.__practiceTouchTrusted), true);
    await client.detach();
  });

  test('matches representative real strokes without accepting reverse short or wrong-order input', async ({
    indexUrl,
    openPage
  }) => {
    const page = await openPage({ reducedMotion: true, viewport: { width: 900, height: 820 } });
    // The curriculum subset has no geometry for 一/戴/藏. 丈 covers horizontal plus
    // left/right falls, 凡 covers the turning hook, and 囊 supplies a 22-stroke complex substitute.
    const matrix = [
      { character: '丈', lesson: 'lesson-12', group: 'write' },
      { character: '亿', lesson: 'lesson-7', group: 'write' },
      { character: '潮', lesson: 'lesson-1', group: 'write' },
      { character: '肃', lesson: 'lesson-22', group: 'write' },
      { character: '凡', lesson: 'lesson-22', group: 'write' },
      { character: '凿', lesson: 'lesson-26', group: 'recognize' },
      { character: '鼎', lesson: 'lesson-1', group: 'recognize' },
      { character: '囊', lesson: 'lesson-19', group: 'recognize' }
    ];

    for (const entry of matrix) {
      await page.goto(withHash(indexUrl, practiceHash(
        entry.lesson, entry.group, 'single', entry.character
      )));
      await waitForPractice(page, entry.character, '引导描写');
      const strokeCount = await page.evaluate((hanzi) => (
        window.HANZI_LIBRARY.characters[hanzi].strokeCount
      ), entry.character);

      await expectRejected(page, entry.character, 0, { reverse: true });
      await restartPractice(page);
      await expectRejected(page, entry.character, 0, { short: true });
      await restartPractice(page);
      await expectRejected(page, entry.character, Math.min(1, strokeCount - 1));
      await restartPractice(page);
      await drawMedian(page, entry.character, 0);
      await waitForStroke(page, 2, strokeCount);
      await drawMedian(page, entry.character, 1, { jitter: 2 });
      await waitForStroke(page, 3, strokeCount);
      assert.match(await page.locator('[data-slot="practice-feedback"]').textContent(), /写对了/);
    }
  });
}
