#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const indexUrl = pathToFileURL(path.join(repoRoot, 'index.html')).href;
const suitePaths = [
  path.join(repoRoot, 'tests/browser/app.spec.mjs'),
  path.join(repoRoot, 'tests/browser/offline.spec.mjs')
];

function offlineStartupMessage(reason) {
  return [
    reason,
    'The browser tests run offline and did not install or download anything.',
    'Set PLAYWRIGHT_CORE_PATH to a playwright-core package directory or its index.mjs file.',
    'If Chromium is installed elsewhere, set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to its executable.'
  ].join('\n');
}

function errorText(error) {
  if (error && typeof error.stack === 'string') return error.stack;
  if (error && typeof error.message === 'string') return error.message;
  return String(error);
}

async function isFile(candidate) {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function moduleEntryFromOverride(value) {
  const candidate = value.startsWith('file:')
    ? fileURLToPath(value)
    : path.resolve(process.cwd(), value);
  let details;
  try {
    details = await stat(candidate);
  } catch (error) {
    throw new Error(`PLAYWRIGHT_CORE_PATH does not exist: ${candidate}\n${errorText(error)}`);
  }
  if (details.isDirectory()) {
    const entry = path.join(candidate, 'index.mjs');
    if (!await isFile(entry)) {
      throw new Error(`PLAYWRIGHT_CORE_PATH package directory has no index.mjs: ${candidate}`);
    }
    return entry;
  }
  if (!details.isFile() || path.basename(candidate) !== 'index.mjs') {
    throw new Error(
      `PLAYWRIGHT_CORE_PATH must name a package directory or index.mjs file: ${candidate}`
    );
  }
  return candidate;
}

async function findExecutableOnPath(name) {
  const pathValue = process.env.PATH || '';
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      try {
        await access(candidate, fsConstants.X_OK);
        if ((await stat(candidate)).isFile()) return candidate;
      } catch {
        // Continue through PATH entries that are absent or not executable.
      }
    }
  }
  return null;
}

function splitCommandLine(value) {
  const tokens = [];
  let token = '';
  let quote = null;
  let escaping = false;
  for (const character of value.trim()) {
    if (escaping) {
      token += character;
      escaping = false;
    } else if (character === '\\' && quote !== "'") {
      escaping = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else token += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = '';
      }
    } else {
      token += character;
    }
  }
  if (escaping) token += '\\';
  if (quote) throw new Error('playwright shebang contains an unterminated quote');
  if (token) tokens.push(token);
  return tokens;
}

function looksLikePython(value) {
  return /^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i.test(path.basename(value));
}

async function pythonFromShebang(playwrightExecutable) {
  const contents = await readFile(playwrightExecutable, 'utf8');
  const firstLine = contents.split(/\r?\n/, 1)[0];
  if (!firstLine.startsWith('#!')) {
    throw new Error(`PATH playwright executable has no shebang: ${playwrightExecutable}`);
  }
  const tokens = splitCommandLine(firstLine.slice(2));
  if (tokens.length === 0) {
    throw new Error(`PATH playwright executable has an empty shebang: ${playwrightExecutable}`);
  }

  const interpreter = tokens.shift();
  const environment = {};
  let python = interpreter;
  let pythonArguments = tokens;
  if (path.basename(interpreter) === 'env') {
    let index = 0;
    if (tokens[index] === '-S' || tokens[index] === '--split-string') index += 1;
    while (index < tokens.length) {
      const token = tokens[index];
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
        const separator = token.indexOf('=');
        environment[token.slice(0, separator)] = token.slice(separator + 1);
        index += 1;
        continue;
      }
      if (token.startsWith('-')) {
        index += 1;
        continue;
      }
      break;
    }
    python = tokens[index];
    pythonArguments = tokens.slice(index + 1);
  }
  if (!python || !looksLikePython(python)) {
    throw new Error(`PATH playwright shebang does not identify Python: ${firstLine}`);
  }
  if (!path.isAbsolute(python)) {
    const resolvedPython = await findExecutableOnPath(python);
    if (!resolvedPython) throw new Error(`Python from playwright shebang is not on PATH: ${python}`);
    python = resolvedPython;
  }
  return { executable: python, arguments: pythonArguments, environment };
}

async function playwrightCoreFromPythonCli() {
  if (process.platform === 'win32') {
    throw new Error(
      'PATH playwright Python-shebang discovery is POSIX-only; use PLAYWRIGHT_CORE_PATH on Windows'
    );
  }
  const cli = await findExecutableOnPath('playwright');
  if (!cli) throw new Error('No playwright executable was found on PATH');
  const python = await pythonFromShebang(cli);
  const discovery = [
    'from pathlib import Path',
    'import playwright',
    "print((Path(playwright.__file__).resolve().parent / 'driver' / 'package' / 'index.mjs').resolve())"
  ].join('\n');
  const result = spawnSync(
    python.executable,
    [...python.arguments, '-c', discovery],
    {
      encoding: 'utf8',
      env: { ...process.env, ...python.environment },
      timeout: 10_000,
      windowsHide: true
    }
  );
  if (result.error) {
    throw new Error(`Could not run Python from ${cli}: ${errorText(result.error)}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Python from ${cli} could not import playwright:\n${(result.stderr || result.stdout).trim()}`
    );
  }
  const entry = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!entry || !await isFile(entry)) {
    throw new Error(`Python playwright driver index.mjs was not found: ${entry || '(empty)'}`);
  }
  return { entry, cli };
}

function requireChromium(module, source) {
  if (!module || !module.chromium || typeof module.chromium.launch !== 'function') {
    throw new Error(`Resolved playwright-core from ${source}, but it does not export chromium.launch`);
  }
  return module;
}

async function resolvePlaywrightCore() {
  const override = process.env.PLAYWRIGHT_CORE_PATH?.trim();
  if (override) {
    const entry = await moduleEntryFromOverride(override);
    const module = await import(pathToFileURL(entry).href);
    return {
      module: requireChromium(module, `PLAYWRIGHT_CORE_PATH (${entry})`),
      source: `PLAYWRIGHT_CORE_PATH (${entry})`
    };
  }

  let packageError;
  try {
    const module = await import('playwright-core');
    return {
      module: requireChromium(module, 'playwright-core package import'),
      source: 'playwright-core package import'
    };
  } catch (error) {
    packageError = error;
  }

  try {
    const discovered = await playwrightCoreFromPythonCli();
    const module = await import(pathToFileURL(discovered.entry).href);
    return {
      module: requireChromium(module, `Python playwright at ${discovered.entry}`),
      source: `PATH playwright (${discovered.cli})`
    };
  } catch (pythonError) {
    throw new Error([
      'Unable to resolve playwright-core.',
      `Package import: ${errorText(packageError)}`,
      `PATH/Python discovery: ${errorText(pythonError)}`
    ].join('\n'));
  }
}

function installAudioProbe() {
  const NativeAudio = window.Audio;
  const records = [];
  function mediaError(media) {
    if (!media.error) return null;
    return { code: media.error.code, message: media.error.message || '' };
  }
  window.__HANZI_AUDIO_PROBE__ = {
    nativeAudio: typeof NativeAudio === 'function',
    snapshot() {
      return {
        nativeAudio: this.nativeAudio,
        records: records.map((record) => ({
          constructorArguments: record.constructorArguments.slice(),
          currentSrc: record.media.currentSrc,
          error: mediaError(record.media),
          errorEvents: record.errorEvents.slice(),
          networkState: record.media.networkState,
          paused: record.media.paused,
          readyState: record.media.readyState,
          src: record.media.src
        }))
      };
    }
  };
  if (typeof NativeAudio !== 'function') return;
  window.Audio = new Proxy(NativeAudio, {
    construct(target, argumentsList) {
      const media = Reflect.construct(target, argumentsList, target);
      const record = {
        constructorArguments: argumentsList.map(String),
        errorEvents: [],
        media
      };
      media.addEventListener('error', () => {
        record.errorEvents.push(mediaError(media));
      });
      records.push(record);
      return media;
    }
  });
}

function diagnosticsError(diagnostics) {
  const problems = [];
  if (diagnostics.httpRequests.length > 0) {
    problems.push(`HTTP(S) requests: ${diagnostics.httpRequests.join(', ')}`);
  }
  if (diagnostics.failedRequests.length > 0) {
    problems.push(`failed requests: ${diagnostics.failedRequests.join(' | ')}`);
  }
  if (diagnostics.pageErrors.length > 0) {
    problems.push(`page errors: ${diagnostics.pageErrors.join(' | ')}`);
  }
  if (diagnostics.consoleProblems.length > 0) {
    problems.push(`console warnings/errors: ${diagnostics.consoleProblems.join(' | ')}`);
  }
  return problems.length === 0
    ? null
    : new Error(`Browser diagnostics were not clean:\n${problems.join('\n')}`);
}

function attachDiagnostics(page, diagnostics) {
  page.on('request', (request) => {
    const url = request.url();
    diagnostics.requests.push(url);
    if (/^https?:/i.test(url)) diagnostics.httpRequests.push(url);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    diagnostics.failedRequests.push(`${request.url()}: ${failure?.errorText || 'unknown failure'}`);
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(errorText(error)));
  page.on('console', (message) => {
    if (['warning', 'warn', 'error'].includes(message.type())) {
      diagnostics.consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
}

function safeArtifactName(value) {
  const name = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return name || 'artifact';
}

function createArtifactPath(artifactRoot) {
  return function artifactPath(fileName) {
    if (typeof fileName !== 'string' || fileName.trim() === '') {
      throw new TypeError('artifactPath(fileName) requires a non-empty file name');
    }
    if (path.basename(fileName) !== fileName || fileName === '.' || fileName === '..') {
      throw new Error(`artifactPath(fileName) does not accept directories: ${fileName}`);
    }
    return path.join(artifactRoot, fileName);
  };
}

async function loadTests() {
  const tests = [];
  const names = new Set();
  function test(name, body) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new TypeError('test(name, body) requires a non-empty name');
    }
    if (typeof body !== 'function') throw new TypeError(`test ${name} requires a function body`);
    if (names.has(name)) throw new Error(`duplicate browser test name: ${name}`);
    names.add(name);
    tests.push(Object.freeze({ name, body }));
  }
  for (const suitePath of suitePaths) {
    const suite = await import(pathToFileURL(suitePath).href);
    if (typeof suite.registerBrowserTests !== 'function') {
      throw new Error(`${suitePath} must export registerBrowserTests({ test })`);
    }
    await suite.registerBrowserTests({ test });
  }
  return tests;
}

async function runOneTest({ browser, artifactRoot, artifactPath, record, index, total }) {
  const context = await browser.newContext({ offline: true });
  const diagnostics = {
    consoleProblems: [],
    failedRequests: [],
    httpRequests: [],
    pageErrors: [],
    requests: []
  };
  let page = null;
  let opened = false;
  let testError = null;
  const startedAt = Date.now();

  async function openPage(options = {}) {
    if (opened) throw new Error('openPage() may only be called once per browser test');
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('openPage(options) requires an object when options are provided');
    }
    opened = true;
    if (options.instrumentAudio === true) await context.addInitScript(installAudioProbe);
    page = await context.newPage();
    attachDiagnostics(page, diagnostics);
    if (options.viewport !== undefined) {
      const { width, height } = options.viewport;
      if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        throw new TypeError('openPage viewport width and height must be positive integers');
      }
      await page.setViewportSize({ width, height });
    }
    if (options.reducedMotion !== undefined) {
      const value = options.reducedMotion === true || options.reducedMotion === 'reduce'
        ? 'reduce'
        : options.reducedMotion === false || options.reducedMotion === 'no-preference'
          ? 'no-preference'
          : null;
      if (value === null) {
        throw new TypeError('openPage reducedMotion must be a boolean, reduce, or no-preference');
      }
      await page.emulateMedia({ reducedMotion: value });
    }
    return page;
  }

  try {
    await record.body({ browser, indexUrl, openPage, artifactPath });
  } catch (error) {
    testError = error;
  }

  const diagnosticFailure = diagnosticsError(diagnostics);
  if (diagnosticFailure) {
    testError = testError
      ? new AggregateError([testError, diagnosticFailure], 'Test and browser diagnostics failed')
      : diagnosticFailure;
  }

  if (testError && page && !page.isClosed()) {
    const screenshotPath = path.join(
      artifactRoot,
      `failure-${String(index + 1).padStart(2, '0')}-${safeArtifactName(record.name)}.png`
    );
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.error(`  Diagnostic screenshot: ${screenshotPath}`);
    } catch (screenshotError) {
      testError = new AggregateError(
        [testError, screenshotError],
        'Test failed and its diagnostic screenshot could not be captured'
      );
    }
  }

  try {
    await context.close();
  } catch (closeError) {
    testError = testError
      ? new AggregateError([testError, closeError], 'Test failed and context cleanup also failed')
      : closeError;
  }

  const duration = Date.now() - startedAt;
  if (testError) {
    console.error(`FAIL ${index + 1}/${total} ${record.name} (${duration} ms)`);
    console.error(errorText(testError));
    return false;
  }
  console.log(`PASS ${index + 1}/${total} ${record.name} (${duration} ms)`);
  return true;
}

async function main() {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'hanzi-browser-'));
  console.log(`Browser artifacts: ${artifactRoot}`);

  let resolved;
  try {
    resolved = await resolvePlaywrightCore();
  } catch (error) {
    throw new Error(offlineStartupMessage(errorText(error)));
  }
  console.log(`playwright-core: ${resolved.source}`);

  const launchOptions = { headless: true };
  const executableOverride = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (executableOverride) {
    launchOptions.executablePath = path.resolve(process.cwd(), executableOverride);
  }

  let browser;
  try {
    browser = await resolved.module.chromium.launch(launchOptions);
  } catch (error) {
    throw new Error(offlineStartupMessage(`Unable to launch Chromium.\n${errorText(error)}`));
  }

  let failures = 0;
  try {
    const tests = await loadTests();
    const artifactPath = createArtifactPath(artifactRoot);
    for (let index = 0; index < tests.length; index += 1) {
      const passed = await runOneTest({
        artifactPath,
        artifactRoot,
        browser,
        index,
        record: tests[index],
        total: tests.length
      });
      if (!passed) failures += 1;
    }
    console.log(`${tests.length - failures} passed, ${failures} failed`);
  } finally {
    await browser.close();
  }
  if (failures > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(errorText(error));
    process.exitCode = 1;
  });
}
