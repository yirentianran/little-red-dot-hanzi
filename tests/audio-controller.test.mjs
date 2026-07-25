import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { createAudioController } = require('../js/audio-controller.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    Object.freeze(value);
  }
  return value;
}

function makeManifest() {
  return {
    format: 'audio/mpeg',
    readings: {
      chao2: { file: 'assets/audio/chao2.mp3' },
      guo1: { file: 'assets/audio/guo1.mp3' }
    }
  };
}

function makeMedia(options = {}) {
  const log = options.log || [];
  const listeners = new Map();
  const removedListeners = [];
  let preload;
  let currentTime;

  const media = {
    pauseCalls: 0,
    playCalls: 0,
    removedListeners,
    get preload() {
      return preload;
    },
    set preload(value) {
      log.push(['preload', value]);
      if (options.preloadError) throw options.preloadError;
      preload = value;
    },
    get currentTime() {
      return currentTime;
    },
    set currentTime(value) {
      log.push(['currentTime', value]);
      if (options.currentTimeError) throw options.currentTimeError;
      currentTime = value;
    },
    addEventListener(type, listener) {
      log.push(['addEventListener', type]);
      listeners.set(type, listener);
      if (options.addEventErrorType === type) throw options.addEventError;
    },
    removeEventListener(type, listener) {
      log.push(['removeEventListener', type]);
      removedListeners.push([type, listener]);
      if (options.removeEventError) throw options.removeEventError;
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    play() {
      media.playCalls += 1;
      log.push(['play']);
      if (options.playError) throw options.playError;
      if (options.onPlay) options.onPlay(media);
      return options.playResult;
    },
    pause() {
      media.pauseCalls += 1;
      log.push(['pause']);
      if (options.pauseError) throw options.pauseError;
    },
    dispatch(type, event = {}) {
      const listener = listeners.get(type);
      if (listener) listener(event);
    },
    capture(type) {
      return listeners.get(type);
    }
  };
  return media;
}

function makeHarness(mediaOptions = {}) {
  const files = [];
  const instances = [];
  const controller = createAudioController(makeManifest(), (file) => {
    files.push(file);
    const options = typeof mediaOptions === 'function'
      ? mediaOptions(instances.length, file)
      : mediaOptions;
    const media = makeMedia(options);
    instances.push(media);
    return media;
  });
  return { controller, files, instances };
}

test('is lazy, preserves a frozen manifest, and exposes a frozen API', () => {
  const manifest = deepFreeze(makeManifest());
  const before = JSON.stringify(manifest);
  let creations = 0;
  const controller = createAudioController(manifest, () => {
    creations += 1;
    return makeMedia();
  });

  assert.equal(creations, 0);
  assert.equal(controller.isAvailable('chao2'), true);
  assert.equal(controller.isAvailable('missing'), false);
  assert.equal(JSON.stringify(manifest), before);
  assert.equal(Object.isFrozen(controller), true);
  assert.deepEqual(Object.keys(controller).sort(), ['destroy', 'isAvailable', 'play', 'stop']);
});

test('uses the exact local path and configures metadata before starting playback', async () => {
  const log = [];
  const { controller, files, instances } = makeHarness({ log, playResult: Promise.resolve() });

  assert.equal(await controller.play('chao2'), true);

  assert.deepEqual(files, ['assets/audio/chao2.mp3']);
  assert.equal(instances[0].preload, 'metadata');
  assert.equal(instances[0].currentTime, 0);
  assert.ok(log.findIndex(([action]) => action === 'preload') < log.findIndex(([action]) => action === 'play'));
  assert.ok(log.findIndex(([action]) => action === 'currentTime') < log.findIndex(([action]) => action === 'play'));

  controller.stop();
  assert.equal(instances[0].pauseCalls, 1, 'fulfilled playback remains active until stopped');
});

test('same-reading and different-reading replays always replace the active media', async (t) => {
  await t.test('same reading', async () => {
    const { controller, instances } = makeHarness({ playResult: Promise.resolve() });
    assert.equal(await controller.play('chao2'), true);
    const oldEnded = instances[0].capture('ended');
    const oldError = instances[0].capture('error');

    assert.equal(await controller.play('chao2'), true);

    assert.equal(instances.length, 2);
    assert.equal(instances[0].pauseCalls, 1);
    assert.deepEqual(instances[0].removedListeners.map(([type]) => type).sort(), ['ended', 'error']);
    oldEnded();
    oldError({ error: new Error('stale media error') });
    assert.equal(controller.isAvailable('chao2'), true);
    controller.stop();
    assert.equal(instances[1].pauseCalls, 1);
  });

  await t.test('different reading', async () => {
    const { controller, files, instances } = makeHarness({ playResult: Promise.resolve() });
    assert.equal(await controller.play('chao2'), true);
    assert.equal(await controller.play('guo1'), true);

    assert.deepEqual(files, ['assets/audio/chao2.mp3', 'assets/audio/guo1.mp3']);
    assert.equal(instances[0].pauseCalls, 1);
    assert.equal(instances.length, 2);
  });
});

test('a replaced pending request resolves false regardless of its later settlement', async (t) => {
  await t.test('late fulfillment', async () => {
    const first = deferred();
    const { controller } = makeHarness((index) => ({
      playResult: index === 0 ? first.promise : Promise.resolve()
    }));

    const oldPlay = controller.play('chao2');
    assert.equal(await controller.play('guo1'), true);
    assert.equal(await oldPlay, false);
    first.resolve();
    await first.promise;
    assert.equal(controller.isAvailable('chao2'), true);
  });

  await t.test('late rejection', async () => {
    const first = deferred();
    const { controller } = makeHarness((index) => ({
      playResult: index === 0 ? first.promise : Promise.resolve()
    }));

    const oldPlay = controller.play('chao2');
    assert.equal(await controller.play('guo1'), true);
    assert.equal(await oldPlay, false);
    first.reject(new Error('late old failure'));
    await assert.rejects(first.promise, /late old failure/);
    await Promise.resolve();
    assert.equal(controller.isAvailable('chao2'), true);
    assert.equal(controller.isAvailable('guo1'), true);
  });
});

test('late ended and error callbacks from a replaced instance cannot affect the current one', async () => {
  const { controller, instances } = makeHarness({ playResult: Promise.resolve() });
  assert.equal(await controller.play('chao2'), true);
  const staleEnded = instances[0].capture('ended');
  const staleError = instances[0].capture('error');
  assert.equal(await controller.play('guo1'), true);

  staleEnded();
  staleError({ error: new Error('stale') });

  assert.equal(controller.isAvailable('chao2'), true);
  assert.equal(controller.isAvailable('guo1'), true);
  controller.stop();
  assert.equal(instances[1].pauseCalls, 1);
});

test('current synchronous failures reject and disable only their reading', async (t) => {
  await t.test('factory throw', async () => {
    let calls = 0;
    const controller = createAudioController(makeManifest(), (file) => {
      calls += 1;
      if (file.endsWith('chao2.mp3')) throw new Error('factory failed');
      return makeMedia({ playResult: Promise.resolve() });
    });

    await assert.rejects(controller.play('chao2'), /factory failed/);
    assert.equal(controller.isAvailable('chao2'), false);
    assert.equal(controller.isAvailable('guo1'), true);
    assert.equal(await controller.play('chao2'), false);
    assert.equal(calls, 1, 'an unavailable reading never calls the factory again');
  });

  await t.test('play throw', async () => {
    const failure = new Error('play failed');
    const { controller } = makeHarness({ playError: failure });
    await assert.rejects(controller.play('chao2'), failure);
    assert.equal(controller.isAvailable('chao2'), false);
    assert.equal(controller.isAvailable('guo1'), true);
  });
});

test('current asynchronous rejection disables only its reading', async () => {
  const failure = new Error('decode failed');
  const { controller } = makeHarness({ playResult: Promise.reject(failure) });

  await assert.rejects(controller.play('chao2'), failure);

  assert.equal(controller.isAvailable('chao2'), false);
  assert.equal(controller.isAvailable('guo1'), true);
});

test('NotAllowedError and AbortError are transient and can be retried', async (t) => {
  for (const name of ['NotAllowedError', 'AbortError']) {
    await t.test(name, async () => {
      let attempt = 0;
      const controller = createAudioController(makeManifest(), () => {
        attempt += 1;
        if (attempt === 1) {
          const error = new Error(name + ' once');
          error.name = name;
          return makeMedia({ playResult: Promise.reject(error) });
        }
        return makeMedia({ playResult: Promise.resolve() });
      });

      await assert.rejects(controller.play('chao2'), (error) => error.name === name);
      assert.equal(controller.isAvailable('chao2'), true);
      assert.equal(await controller.play('chao2'), true);
      assert.equal(attempt, 2);
    });
  }
});

test('a current media error rejects deterministically and handles a later play rejection', async () => {
  const playback = deferred();
  const { controller, instances } = makeHarness({ playResult: playback.promise });
  const result = controller.play('chao2');
  const mediaError = new Error('media decode error');

  instances[0].dispatch('error', { error: mediaError });

  await assert.rejects(result, mediaError);
  assert.equal(controller.isAvailable('chao2'), false);
  assert.equal(controller.isAvailable('guo1'), true);
  playback.reject(new Error('same operation later rejected'));
  await assert.rejects(playback.promise, /same operation later rejected/);
  await Promise.resolve();
});

test('an error after play has fulfilled disables that reading and clears active media', async () => {
  const { controller, instances } = makeHarness({ playResult: Promise.resolve() });
  assert.equal(await controller.play('chao2'), true);

  instances[0].dispatch('error', { error: new Error('late decode failure') });

  assert.equal(controller.isAvailable('chao2'), false);
  controller.stop();
  assert.equal(instances[0].pauseCalls, 1, 'error cleanup pauses once; stop is then a no-op');
});

test('ended clears fulfilled playback so a later stop does not pause it', async () => {
  const { controller, instances } = makeHarness({ playResult: Promise.resolve() });
  assert.equal(await controller.play('chao2'), true);

  instances[0].dispatch('ended');
  controller.stop();

  assert.equal(instances[0].pauseCalls, 0);
  assert.deepEqual(instances[0].removedListeners.map(([type]) => type).sort(), ['ended', 'error']);
  assert.equal(controller.isAvailable('chao2'), true);
});

test('configuration throws disable only the requested reading and clean partial setup', async (t) => {
  const cases = [
    ['preload', { preloadError: new Error('preload failed') }, []],
    ['currentTime', { currentTimeError: new Error('seek failed') }, []],
    [
      'addEventListener',
      { addEventErrorType: 'error', addEventError: new Error('listener failed') },
      ['ended', 'error']
    ]
  ];

  for (const [name, options, expectedRemovals] of cases) {
    await t.test(name, async () => {
      const instances = [];
      const controller = createAudioController(makeManifest(), () => {
        const media = makeMedia(options);
        instances.push(media);
        return media;
      });

      await assert.rejects(controller.play('chao2'));

      assert.equal(controller.isAvailable('chao2'), false);
      assert.equal(controller.isAvailable('guo1'), true);
      assert.equal(instances[0].pauseCalls, 1);
      assert.deepEqual(
        instances[0].removedListeners.map(([type]) => type).sort(),
        expectedRemovals
      );
    });
  }
});

test('cleanup exceptions cannot block stop, replacement, or destroy', async (t) => {
  for (const action of ['stop', 'replace', 'destroy']) {
    await t.test(action, async () => {
      const first = deferred();
      const instances = [];
      const controller = createAudioController(makeManifest(), (file) => {
        const media = makeMedia(instances.length === 0
          ? {
              playResult: first.promise,
              pauseError: new Error('pause cleanup failed'),
              removeEventError: new Error('listener cleanup failed')
            }
          : { playResult: Promise.resolve() });
        instances.push(media);
        return media;
      });
      const pending = controller.play('chao2');
      const staleError = instances[0].capture('error');

      if (action === 'stop') controller.stop();
      if (action === 'replace') assert.equal(await controller.play('guo1'), true);
      if (action === 'destroy') controller.destroy();

      assert.equal(await pending, false);
      assert.equal(instances[0].pauseCalls, 1);
      staleError({ error: new Error('removed callback fired late') });
      assert.equal(
        controller.isAvailable('chao2'),
        action !== 'destroy',
        'cleanup exceptions do not change per-reading availability'
      );
      first.reject(new Error('late rejection after cleanup exception'));
      await assert.rejects(first.promise, /late rejection/);
      await Promise.resolve();
    });
  }
});

test('transient media error events reject without making the reading unavailable', async (t) => {
  for (const name of ['NotAllowedError', 'AbortError']) {
    await t.test(name, async () => {
      const pending = deferred();
      const { controller, instances } = makeHarness({ playResult: pending.promise });
      const result = controller.play('chao2');
      const transient = new Error(name + ' from media');
      transient.name = name;

      instances[0].dispatch('error', { error: transient });

      await assert.rejects(result, (error) => error.name === name);
      assert.equal(controller.isAvailable('chao2'), true);
      pending.resolve();
      await pending.promise;
      assert.equal(await controller.play('chao2'), true);
    });
  }
});

test('an undefined media.play return means playback started synchronously', async () => {
  const { controller, instances } = makeHarness({ playResult: undefined });

  assert.equal(await controller.play('chao2'), true);
  controller.stop();
  assert.equal(instances[0].pauseCalls, 1);
});

test('unknown, inherited, and unavailable IDs never call the media factory', async () => {
  const inheritedReadings = { inherited: { file: 'assets/audio/inherited.mp3' } };
  const readings = Object.assign(Object.create(inheritedReadings), {
    chao2: { file: 'assets/audio/chao2.mp3' },
    guo1: { file: 'assets/audio/guo1.mp3' }
  });
  let calls = 0;
  const controller = createAudioController({ format: 'audio/mpeg', readings }, () => {
    calls += 1;
    throw new Error('known reading failure');
  });

  assert.equal(await controller.play('missing'), false);
  assert.equal(await controller.play('inherited'), false);
  assert.equal(controller.isAvailable('inherited'), false);
  assert.equal(calls, 0);

  await assert.rejects(controller.play('chao2'), /known reading failure/);
  assert.equal(await controller.play('chao2'), false);
  assert.equal(calls, 1);
});

test('stop is idempotent, cancels a pending request, and keeps availability unchanged', async () => {
  const playback = deferred();
  const { controller, instances } = makeHarness({ playResult: playback.promise });
  const result = controller.play('chao2');

  controller.stop();
  controller.stop();

  assert.equal(await result, false);
  assert.equal(instances[0].pauseCalls, 1);
  assert.equal(controller.isAvailable('chao2'), true);
  playback.reject(new Error('late after stop'));
  await assert.rejects(playback.promise, /late after stop/);
  await Promise.resolve();
});

test('destroy is idempotent, cancels pending work, and makes the controller unavailable', async () => {
  const playback = deferred();
  const { controller, instances } = makeHarness({ playResult: playback.promise });
  const staleError = [];
  const result = controller.play('chao2');
  staleError.push(instances[0].capture('error'));

  controller.destroy();
  controller.destroy();

  assert.equal(await result, false);
  assert.equal(instances[0].pauseCalls, 1);
  assert.equal(controller.isAvailable('chao2'), false);
  await assert.rejects(controller.play('chao2'), /destroyed/i);
  await assert.rejects(controller.play('chao2'), /destroyed/i);
  staleError[0]({ error: new Error('too late') });
  playback.reject(new Error('late after destroy'));
  await assert.rejects(playback.promise, /late after destroy/);
  await Promise.resolve();
});

test('validates the complete manifest and rejects non-local paths', () => {
  const factory = () => makeMedia();
  const invalidCases = [
    [null, /audioManifest/],
    [{ readings: {} }, /format.*own property/],
    [{ format: 'audio/ogg', readings: {} }, /format.*audio\/mpeg/],
    [{ format: 'audio/mpeg' }, /readings.*own property/],
    [{ format: 'audio/mpeg', readings: [] }, /readings.*object/],
    [{ format: 'audio/mpeg', readings: { '': { file: 'assets/audio/a.mp3' } } }, /reading id/],
    [{ format: 'audio/mpeg', readings: { a: null } }, /readings\.a/],
    [{ format: 'audio/mpeg', readings: { a: {} } }, /file.*own property/],
    [{ format: 'audio/mpeg', readings: { a: { file: '' } } }, /file/],
    [{ format: 'audio/mpeg', readings: { a: { file: '/assets/audio/a.mp3' } } }, /relative local path/],
    [{ format: 'audio/mpeg', readings: { a: { file: 'https://example.test/a.mp3' } } }, /relative local path/],
    [{ format: 'audio/mpeg', readings: { a: { file: '//example.test/a.mp3' } } }, /relative local path/],
    [{ format: 'audio/mpeg', readings: { a: { file: '../a.mp3' } } }, /relative local path/],
    [{ format: 'audio/mpeg', readings: { a: { file: 'assets/../a.mp3' } } }, /relative local path/],
    [{ format: 'audio/mpeg', readings: { a: { file: 'assets\\audio\\a.mp3' } } }, /relative local path/],
    [{ format: 'audio/mpeg', readings: { a: { file: 'assets/audio/a.mp3?remote=1' } } }, /relative local path/],
    [{ format: 'audio/mpeg', readings: {}, extra: true }, /unknown field/],
    [{ format: 'audio/mpeg', readings: { a: { file: 'assets/audio/a.mp3', extra: true } } }, /unknown field/]
  ];

  for (const [manifest, expectation] of invalidCases) {
    assert.throws(() => createAudioController(manifest, factory), expectation);
  }

  const inheritedFormat = Object.assign(Object.create({ format: 'audio/mpeg' }), { readings: {} });
  assert.throws(() => createAudioController(inheritedFormat, factory), /format.*own property/);
});

test('validates the factory and each media-like instance with clear errors', async (t) => {
  assert.throws(() => createAudioController(makeManifest(), null), /createAudio.*function/);

  const invalidMedia = [
    [null, /media.*object/],
    [{}, /media\.play.*function/],
    [{ play() {} }, /media\.pause.*function/],
    [{ play() {}, pause() {} }, /media\.addEventListener.*function/],
    [{ play() {}, pause() {}, addEventListener() {} }, /media\.removeEventListener.*function/]
  ];

  for (const [media, expectation] of invalidMedia) {
    await t.test(expectation.source, async () => {
      const controller = createAudioController(makeManifest(), () => media);
      await assert.rejects(controller.play('chao2'), expectation);
      assert.equal(controller.isAvailable('chao2'), false);
      assert.equal(controller.isAvailable('guo1'), true);
    });
  }
});

test('classic script merges its API without accessing DOM or fetch', async () => {
  const source = await readFile(new URL('../js/audio-controller.js', import.meta.url), 'utf8');
  const sentinel = {};
  const context = vm.createContext({
    window: { HanziApp: { sentinel } },
    Object,
    Promise,
    TypeError,
    Error,
    Set,
    Map
  });

  vm.runInContext(source, context, { filename: 'audio-controller.js' });

  assert.equal(context.window.HanziApp.sentinel, sentinel);
  assert.equal(typeof context.window.HanziApp.createAudioController, 'function');
});
