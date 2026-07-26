import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cssUrl = new URL('../styles.css', import.meta.url);

async function readStyles() {
  return readFile(cssUrl, 'utf8');
}

function ruleBody(css, selector, containing) {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((value) => value.trim());
    if (selectors.includes(selector) && (!containing || containing.test(match[2]))) {
      return match[2];
    }
  }
  assert.fail(`Missing CSS rule for ${selector}`);
}

function mediaBody(css, query) {
  const start = css.indexOf(`@media (${query})`);
  assert.notEqual(start, -1, `Missing media query ${query}`);
  const openingBrace = css.indexOf('{', start);
  assert.notEqual(openingBrace, -1, `Missing opening brace for media query ${query}`);
  let depth = 1;
  for (let index = openingBrace + 1; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(openingBrace + 1, index);
  }
  assert.fail(`Missing closing brace for media query ${query}`);
}

function customProperty(body, name) {
  const match = body.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  assert.ok(match, `Missing six-digit color token ${name}`);
  return match[1];
}

function relativeLuminance(hexColor) {
  const channels = hexColor.slice(1).match(/.{2}/g).map((value) => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const luminances = [relativeLuminance(first), relativeLuminance(second)]
    .sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

test('media helper isolates one nested media block', () => {
  const fixture = [
    '@media (example) {',
    '  .inside { color: red; }',
    '}',
    '.outside { color: blue; }'
  ].join('\n');

  const body = mediaBody(fixture, 'example');

  assert.match(body, /\.inside/);
  assert.doesNotMatch(body, /\.outside/);
});

test('practice board keeps a stable square drawing surface', async () => {
  const css = await readStyles();
  const board = ruleBody(css, '.practice-board');

  assert.match(board, /position:\s*relative/i);
  assert.match(board, /width:\s*min\(100%,\s*620px\)/i);
  assert.match(board, /aspect-ratio:\s*1(?:\s*\/\s*1)?/i);
  assert.match(board, /overflow:\s*hidden/i);
  assert.match(board, /touch-action:\s*none/i);
});

test('writer and feedback layers cannot resize the board', async () => {
  const css = await readStyles();
  const writerHost = ruleBody(css, '.practice-writer-host');
  const overlay = ruleBody(css, '.practice-overlay');
  const feedback = ruleBody(css, '.practice-feedback', /min-height:/i);

  for (const layer of [writerHost, overlay]) {
    assert.match(layer, /position:\s*absolute/i);
    assert.match(layer, /inset:\s*0/i);
    assert.match(layer, /width:\s*100%/i);
    assert.match(layer, /height:\s*100%/i);
  }
  assert.match(feedback, /min-height:\s*48px/i);
});

test('practice surface is one column by default and two columns on wide screens', async () => {
  const css = await readStyles();
  const surface = ruleBody(css, '.view--practice');
  const wide = mediaBody(css, 'min-width: 760px');
  const wideSurface = ruleBody(wide, '.view--practice');
  const wideCommonRows = ruleBody(
    wide,
    '.view--practice > :not(.practice-board):not(.practice-tools)'
  );

  assert.match(surface, /display:\s*grid/i);
  assert.match(surface, /grid-template-columns:\s*minmax\(0,\s*1fr\)/i);
  assert.match(wideSurface, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(240px,\s*320px\)/i);
  assert.match(wideCommonRows, /grid-column:\s*1\s*\/\s*-1/i);
  assert.match(
    ruleBody(css, '.practice-retry-result', /grid-column:/i),
    /grid-column:\s*1\s*\/\s*-1/i
  );
  assert.match(
    ruleBody(css, '.practice-complete-result', /grid-column:/i),
    /grid-column:\s*1\s*\/\s*-1/i
  );
});

test('practice tools, actions, and long text remain usable without nested cards', async () => {
  const css = await readStyles();
  const tools = ruleBody(css, '.practice-tools');
  const warning = ruleBody(css, '.practice-persistence-warning');
  const actions = ruleBody(css, '.practice-actions');
  const actionButton = ruleBody(css, '.practice-actions > .button', /min-width:/i);

  assert.match(tools, /width:\s*100%/i);
  assert.match(tools, /background:\s*var\(--sunny-yellow\)/i);
  assert.match(tools, /border-radius:\s*0/i);
  assert.match(warning, /width:\s*100%/i);
  assert.match(warning, /background:\s*var\(--sunny-yellow-soft\)/i);
  assert.match(actions, /display:\s*grid/i);
  assert.match(actions, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*10rem\),\s*1fr\)\)/i);
  assert.match(actionButton, /min-width:\s*44px/i);
  assert.match(actionButton, /min-height:\s*44px/i);
  assert.match(actionButton, /white-space:\s*normal/i);
  assert.match(
    ruleBody(css, '.practice-lesson-title', /overflow-wrap:/i),
    /overflow-wrap:\s*anywhere/i
  );
  assert.match(
    ruleBody(css, '.practice-feedback', /overflow-wrap:/i),
    /overflow-wrap:\s*anywhere/i
  );
});

test('error feedback text meets normal-text contrast on the yellow toolbar', async () => {
  const css = await readStyles();
  const root = ruleBody(css, ':root');
  const errorFeedback = ruleBody(css, '.practice-feedback[data-kind="error"]');
  const colorReference = errorFeedback.match(/color:\s*var\((--[a-z0-9-]+)\)/i);

  assert.ok(colorReference, 'Error feedback must use a named color token');
  const foreground = customProperty(root, colorReference[1]);
  const background = customProperty(root, '--sunny-yellow');
  const ratio = contrastRatio(foreground, background);

  assert.ok(ratio >= 4.5, `Error feedback contrast ${ratio.toFixed(2)} must be at least 4.5:1`);
});

test('error traces fade unless reduced motion is requested', async () => {
  const css = await readStyles();
  const errorPath = ruleBody(css, '.practice-error-path');
  const reduced = mediaBody(css, 'prefers-reduced-motion: reduce');

  assert.match(errorPath, /stroke:\s*var\(--tracking-red\)/i);
  assert.match(errorPath, /animation:/i);
  assert.match(css, /@keyframes\s+practice-error-fade/i);
  assert.match(ruleBody(reduced, '.practice-error-path'), /animation:\s*none/i);
});
