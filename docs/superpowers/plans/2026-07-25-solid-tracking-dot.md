# Solid Tracking Dot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the haloed, white-outlined stroke tracker with one radius-18 solid red SVG circle while preserving all tracking behavior.

**Architecture:** Keep the existing `svg-renderer` ownership boundary and stable `data-tracking-dot="core"` hook. Remove the outer circle and update only the remaining core circle during hide/show and position changes; controllers and timing remain untouched.

**Tech Stack:** Browser-native SVG, classic JavaScript, Node.js test runner, offline Playwright browser harness.

---

### Task 1: Define and implement the single solid-dot SVG contract

**Files:**
- Modify: `tests/svg-renderer.test.mjs:174-280`
- Modify: `js/svg-renderer.js:272-290`
- Modify: `js/svg-renderer.js:336-382`

- [ ] **Step 1: Write the failing SVG renderer assertions**

In the layer-construction test, replace the outer/core styling assertions with the following single-dot contract:

```js
const trackingDots = withClass(svg, 'hanzi-tracking-dot');
const [coreDot] = withClass(svg, 'hanzi-tracking-dot--core');

assert.equal(trackingDots.length, 1);
assert.equal(withClass(svg, 'hanzi-tracking-dot--outer').length, 0);
assert.equal(coreDot.parentNode.parentNode, geometryLayer);
assert.equal(coreDot.getAttribute('r'), '18');
assert.equal(coreDot.getAttribute('fill'), '#d92d20');
assert.equal(coreDot.getAttribute('stroke'), null);
assert.equal(coreDot.getAttribute('stroke-width'), null);
assert.equal(coreDot.getAttribute('opacity'), null);
assert.equal(coreDot.getAttribute('display'), 'none');
```

In `exposes exactly one stable core tracking dot hook per renderer`, remove the outer-dot binding and add:

```js
assert.equal(withClass(container, 'hanzi-tracking-dot').length, 1);
assert.equal(withClass(container, 'hanzi-tracking-dot--outer').length, 0);
```

In the progress test, remove the outer-dot binding and its display/coordinate assertions. Retain the existing core-dot assertions so position tracking remains covered.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/svg-renderer.test.mjs
```

Expected: FAIL because two tracking circles still exist, the core radius is `13`, and the core still has a white stroke.

- [ ] **Step 3: Implement the minimal single-dot renderer**

Replace both circle declarations with:

```js
var coreDot = createElement(documentObject, 'circle', {
  'class': 'hanzi-tracking-dot hanzi-tracking-dot--core',
  'data-tracking-dot': 'core',
  'r': 18,
  'fill': '#d92d20',
  'display': 'none'
});
dotLayer.appendChild(coreDot);
```

Update `hideRevealsAndDots()` so it hides only the core:

```js
setDisplay(coreDot, false);
```

Update `setStrokeProgress()` so it positions and shows only the core:

```js
coreDot.setAttribute('cx', point.x);
coreDot.setAttribute('cy', point.y);
setDisplay(coreDot, true);
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/svg-renderer.test.mjs
```

Expected: all SVG renderer tests PASS with no warnings.

### Task 2: Verify the contract in a real offline browser

**Files:**
- Modify: `tests/browser/app.spec.mjs:254-280`

- [ ] **Step 1: Add browser-level solid-dot assertions**

After loading `潮` in the existing SVG raster test, add:

```js
const trackingDots = page.locator('[data-slot="character-board"] .hanzi-tracking-dot');
assert.equal(await trackingDots.count(), 1);
assert.equal(await page.locator('.hanzi-tracking-dot--outer').count(), 0);
assert.deepEqual(
  await page.locator('[data-tracking-dot="core"]').evaluate((dot) => ({
    fill: dot.getAttribute('fill'),
    opacity: dot.getAttribute('opacity'),
    radius: dot.getAttribute('r'),
    stroke: dot.getAttribute('stroke')
  })),
  { fill: '#d92d20', opacity: null, radius: '18', stroke: null }
);
```

- [ ] **Step 2: Run the offline browser acceptance suite**

Run:

```bash
npm run test:browser
```

Expected: `10 passed, 0 failed`; the existing movement and pause tests continue to track the same core hook, and nine responsive screenshots are generated.

- [ ] **Step 3: Inspect a live character screenshot**

Open a write character such as `潮`, wait until the tracking dot is visible, and capture the board. Confirm the marker is one pure red filled circle with no white border or translucent halo, and that it remains centered on the active stroke.

### Task 3: Run full regression checks and commit

**Files:**
- Verify: `js/svg-renderer.js`
- Verify: `tests/svg-renderer.test.mjs`
- Verify: `tests/browser/app.spec.mjs`

- [ ] **Step 1: Run the complete deterministic checks**

Run:

```bash
npm run check
node --check js/svg-renderer.js
node --check tests/browser/app.spec.mjs
git diff --check
```

Expected: 296 unit tests PASS, the library is valid, runtime data rebuilds with the existing hash, both syntax checks exit zero, and `git diff --check` reports no errors.

- [ ] **Step 2: Review the final diff for scope**

Run:

```bash
git diff -- js/svg-renderer.js tests/svg-renderer.test.mjs tests/browser/app.spec.mjs
git status --short
```

Expected: only the three planned implementation/test files are modified; the already committed design and plan documents are not dirty.

- [ ] **Step 3: Commit the verified change**

Run:

```bash
git add js/svg-renderer.js tests/svg-renderer.test.mjs tests/browser/app.spec.mjs
git commit -m "fix: render a solid tracking dot"
```

Expected: one focused commit containing the renderer change and both regression layers.
