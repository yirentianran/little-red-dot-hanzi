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
  let playing = false;

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
      if (options.onPreload) options.onPreload(media, value);
    },
    get currentTime() {
      return currentTime;
    },
    set currentTime(value) {
      log.push(['currentTime', value]);
      if (options.currentTimeError) throw options.currentTimeError;
      currentTime = value;
      if (options.onCurrentTime) options.onCurrentTime(media, value);
    },
    addEventListener(type, listener) {
      log.push(['addEventListener', type]);
      if (options.addHookBeforeStore && options.onAddEventListener) {
        options.onAddEventListener(type, listener, media);
      }
      listeners.set(type, listener);
      if (!options.addHookBeforeStore && options.onAddEventListener) {
        options.onAddEventListener(type, listener, media);
      }
      if (options.addEventErrorType === type) throw options.addEventError;
    },
    removeEventListener(type, listener) {
      log.push(['removeEventListener', type]);
      removedListeners.push([type, listener]);
      if (options.onRemoveEventListener) options.onRemoveEventListener(type, listener, media);
      if (options.removeEventError) throw options.removeEventError;
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    play() {
      media.playCalls += 1;
      log.push(['play']);
      if (options.playError) throw options.playError;
      if (options.onPlay) options.onPlay(media);
      playing = true;
      return options.playResult;
    },
    pause() {
      media.pauseCalls += 1;
      log.push(['pause']);
      playing = false;
      if (options.onPause) options.onPause(media);
      if (options.pauseError) throw options.pauseError;
    },
    dispatch(type, event = {}) {
      const listener = listeners.get(type);
      if (listener) listener(event);
    },
    capture(type) {
      return listeners.get(type);
    },
    restart() {
      playing = true;
    },
    get playing() {
      return playing;
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

test('cleanup reentrancy gives the nested play command final ownership', async (t) => {
  for (const boundary of ['removeEventListener', 'pause']) {
    await t.test(boundary, async () => {
      const files = [];
      const instances = [];
      let controller;
      let nestedPlay;
      let reentered = false;
      controller = createAudioController(makeManifest(), (file) => {
        files.push(file);
        const options = instances.length === 0
          ? {
              playResult: Promise.resolve(),
              onRemoveEventListener() {
                if (boundary !== 'removeEventListener' || reentered) return;
                reentered = true;
                nestedPlay = controller.play('chao2');
              },
              onPause() {
                if (boundary !== 'pause' || reentered) return;
                reentered = true;
                nestedPlay = controller.play('chao2');
              }
            }
          : { playResult: Promise.resolve() };
        const media = makeMedia(options);
        instances.push(media);
        return media;
      });
      assert.equal(await controller.play('chao2'), true);

      const outerPlay = controller.play('guo1');

      assert.equal(await outerPlay, false);
      assert.equal(await nestedPlay, true);
      assert.deepEqual(files, ['assets/audio/chao2.mp3', 'assets/audio/chao2.mp3']);
      assert.equal(instances.length, 2, 'the superseded outer command never creates media');
      controller.stop();
      assert.equal(instances[1].pauseCalls, 1, 'stop still owns the nested playback');
    });
  }
});

test('configuration reentrancy aborts the stale transaction at every external boundary', async (t) => {
  const cases = [
    {
      name: 'preload destroy',
      options(command) {
        return { playResult: undefined, onPreload: command };
      },
      command(controller) {
        controller.destroy();
      },
      destroyed: true
    },
    {
      name: 'currentTime play',
      options(command) {
        return { playResult: undefined, onCurrentTime: command };
      },
      command(controller, remember) {
        remember(controller.play('guo1'));
      }
    },
    {
      name: 'ended listener stop',
      options(command) {
        return {
          playResult: undefined,
          addHookBeforeStore: true,
          onAddEventListener(type) {
            if (type === 'ended') command();
          }
        };
      },
      command(controller) {
        controller.stop();
      }
    },
    {
      name: 'error listener play',
      options(command) {
        return {
          playResult: undefined,
          addHookBeforeStore: true,
          onAddEventListener(type) {
            if (type === 'error') command();
          }
        };
      },
      command(controller, remember) {
        remember(controller.play('guo1'));
      }
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const instances = [];
      let controller;
      let nestedPlay;
      let commanded = false;
      const remember = (promise) => {
        nestedPlay = promise;
      };
      const command = () => {
        if (commanded) return;
        commanded = true;
        scenario.command(controller, remember);
      };
      controller = createAudioController(makeManifest(), () => {
        const options = instances.length === 0
          ? scenario.options(command)
          : { playResult: Promise.resolve() };
        const media = makeMedia(options);
        instances.push(media);
        return media;
      });

      const stalePlay = controller.play('chao2');

      assert.equal(await stalePlay, false);
      assert.equal(instances[0].playCalls, 0, 'stale configuration never reaches media.play');
      assert.equal(instances[0].pauseCalls, 1, 'partially configured media is rolled back');
      assert.equal(instances[0].playing, false);
      assert.equal(instances[0].capture('ended'), undefined);
      assert.equal(instances[0].capture('error'), undefined);
      if (nestedPlay) {
        assert.equal(await nestedPlay, true);
        controller.stop();
        assert.equal(instances[1].pauseCalls, 1);
      }
      if (scenario.destroyed) assert.equal(controller.isAvailable('guo1'), false);
    });
  }
});

test('play and then-getter reentrancy cannot restart or displace nested playback', async (t) => {
  await t.test('media.play', async () => {
    const instances = [];
    let controller;
    let nestedPlay;
    controller = createAudioController(makeManifest(), () => {
      const options = instances.length === 0
        ? {
            playResult: undefined,
            onPlay() {
              nestedPlay = controller.play('guo1');
            }
          }
        : { playResult: Promise.resolve() };
      const media = makeMedia(options);
      instances.push(media);
      return media;
    });

    const stalePlay = controller.play('chao2');

    assert.equal(await stalePlay, false);
    assert.equal(await nestedPlay, true);
    assert.equal(instances[0].playing, false, 'stale media is paused after play returns');
    assert.equal(instances[0].pauseCalls, 2, 'post-play rollback cannot trust an earlier pause');
    controller.stop();
    assert.equal(instances[1].pauseCalls, 1);
  });

  await t.test('then getter', async () => {
    const instances = [];
    let controller;
    let nestedPlay;
    let getterCalls = 0;
    const playResult = {};
    Object.defineProperty(playResult, 'then', {
      get() {
        getterCalls += 1;
        if (getterCalls === 1) nestedPlay = controller.play('guo1');
        return (resolve) => resolve();
      }
    });
    controller = createAudioController(makeManifest(), () => {
      const media = makeMedia(instances.length === 0
        ? { playResult }
        : { playResult: Promise.resolve() });
      instances.push(media);
      return media;
    });

    const stalePlay = controller.play('chao2');

    assert.equal(await stalePlay, false);
    assert.equal(await nestedPlay, true);
    assert.equal(getterCalls, 1, 'the stale thenable is not assimilated after losing ownership');
    assert.equal(instances[0].playing, false);
    controller.stop();
    assert.equal(instances[1].pauseCalls, 1);
  });
});

test('media method getters stop validation as soon as a nested command takes ownership', async (t) => {
  for (const boundary of ['play', 'pause']) {
    await t.test(boundary + ' getter', async () => {
      const instances = [];
      let controller;
      let nestedPlay;
      let reentered = false;
      let lateAddReads = 0;
      controller = createAudioController(makeManifest(), () => {
        if (instances.length > 0) {
          const nestedMedia = makeMedia({ playResult: Promise.resolve() });
          instances.push(nestedMedia);
          return nestedMedia;
        }

        const media = makeMedia({ playResult: Promise.resolve() });
        const playMethod = media.play;
        const pauseMethod = media.pause;
        const addEventListenerMethod = media.addEventListener;
        Object.defineProperty(media, 'play', {
          get() {
            if (boundary === 'play' && !reentered) {
              reentered = true;
              nestedPlay = controller.play('guo1');
            }
            return playMethod;
          }
        });
        Object.defineProperty(media, 'pause', {
          get() {
            if (boundary === 'pause' && !reentered) {
              reentered = true;
              nestedPlay = controller.play('guo1');
            }
            return pauseMethod;
          }
        });
        Object.defineProperty(media, 'addEventListener', {
          get() {
            lateAddReads += 1;
            return addEventListenerMethod;
          }
        });
        instances.push(media);
        return media;
      });

      const stalePlay = controller.play('chao2');

      assert.equal(await stalePlay, false);
      assert.equal(await nestedPlay, true);
      assert.equal(lateAddReads, 0, 'later media getters are not read after ownership changes');
      assert.equal(instances[0].pauseCalls, 1, 'raw media receives a best-effort rollback pause');
      controller.stop();
      assert.equal(instances[1].pauseCalls, 1);
    });
  }
});

test('a rejection name getter cannot disable a nested retry of the same reading', async () => {
  const instances = [];
  let controller;
  let nestedPlay;
  let reentered = false;
  const failure = {};
  Object.defineProperty(failure, 'name', {
    get() {
      if (!reentered) {
        reentered = true;
        nestedPlay = controller.play('chao2');
      }
      return 'DecodeError';
    }
  });
  controller = createAudioController(makeManifest(), () => {
    const media = makeMedia(instances.length === 0
      ? { playResult: Promise.reject(failure) }
      : { playResult: Promise.resolve() });
    instances.push(media);
    return media;
  });

  const stalePlay = controller.play('chao2');

  assert.equal(await stalePlay, false);
  assert.equal(await nestedPlay, true);
  assert.equal(controller.isAvailable('chao2'), true);
  controller.stop();
  assert.equal(instances[1].pauseCalls, 1);
});

test('a media error getter is read once and cannot pollute a nested retry', async () => {
  const { controller, instances } = makeHarness({ playResult: Promise.resolve() });
  assert.equal(await controller.play('chao2'), true);
  let nestedPlay;
  let reads = 0;
  const event = {};
  Object.defineProperty(event, 'error', {
    get() {
      reads += 1;
      if (reads === 1) {
        nestedPlay = controller.play('chao2');
        instances[0].restart();
      }
      return new Error('old media error');
    }
  });

  instances[0].dispatch('error', event);

  assert.equal(reads, 1);
  assert.equal(await nestedPlay, true);
  assert.equal(controller.isAvailable('chao2'), true);
  assert.equal(instances[0].playing, false);
  assert.equal(instances[0].pauseCalls, 2, 'normal cancellation and post-getter rollback both pause');
  controller.stop();
  assert.equal(instances[1].pauseCalls, 1);
});

test('a synchronous thenable cannot commit success before its call boundary returns', async () => {
  const instances = [];
  let controller;
  let nestedPlay;
  const thenable = {
    then(resolve) {
      resolve();
      nestedPlay = controller.play('guo1');
    }
  };
  controller = createAudioController(makeManifest(), () => {
    const media = makeMedia(instances.length === 0
      ? { playResult: thenable }
      : { playResult: Promise.resolve() });
    instances.push(media);
    return media;
  });

  const stalePlay = controller.play('chao2');

  assert.equal(await stalePlay, false);
  assert.equal(await nestedPlay, true);
  assert.equal(instances[0].playing, false);
  controller.stop();
  assert.equal(instances[1].pauseCalls, 1);
});

test('thenable fulfillment values are not assimilated as a second playback request', async () => {
  let calls = 0;
  const thenable = {
    then(resolve) {
      calls += 1;
      if (calls === 1) resolve(thenable);
      else resolve();
    }
  };
  const { controller } = makeHarness({ playResult: thenable });

  assert.equal(await controller.play('chao2'), true);
  assert.equal(calls, 1);
});

test('cleanup inside failure and ended handlers cannot clear a nested request', async (t) => {
  for (const boundary of ['failure', 'ended']) {
    await t.test(boundary, async () => {
      const instances = [];
      let controller;
      let nestedPlay;
      let reentered = false;
      controller = createAudioController(makeManifest(), () => {
        const options = instances.length === 0
          ? {
              playResult: boundary === 'ended' ? Promise.resolve() : undefined,
              playError: boundary === 'failure' ? new Error('start failed') : undefined,
              onRemoveEventListener() {
                if (reentered) return;
                reentered = true;
                nestedPlay = controller.play('guo1');
              }
            }
          : { playResult: Promise.resolve() };
        const media = makeMedia(options);
        instances.push(media);
        return media;
      });

      const firstPlay = controller.play('chao2');
      if (boundary === 'ended') {
        assert.equal(await firstPlay, true);
        instances[0].dispatch('ended');
      } else {
        assert.equal(await firstPlay, false, 'the nested command supersedes the old failure');
      }

      assert.equal(await nestedPlay, true);
      controller.stop();
      assert.equal(instances[1].pauseCalls, 1);
    });
  }
});

test('a throwing rejection name getter still settles the public promise', async () => {
  const failure = {};
  Object.defineProperty(failure, 'name', {
    get() {
      throw new Error('hostile name getter');
    }
  });
  const { controller } = makeHarness({ playResult: Promise.reject(failure) });

  const observed = await Promise.race([
    controller.play('chao2').then(
      () => ({ type: 'resolved' }),
      (error) => ({ type: 'rejected', error })
    ),
    new Promise((resolve) => setImmediate(() => resolve({ type: 'timeout' })))
  ]);

  assert.equal(observed.type, 'rejected');
  assert.equal(observed.error, failure);
  assert.equal(controller.isAvailable('chao2'), false);
  assert.equal(controller.isAvailable('guo1'), true);
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
    [{ format: 'audio/mpeg', readings: { a: { file: 'assets/%2e%2e/a.mp3' } } }, /relative local path/],
    [{ format: 'audio/mpeg', readings: { a: { file: 'assets/%2E%2E/a.mp3' } } }, /relative local path/],
    [{ format: 'audio/mpeg', readings: { a: { file: 'assets/%2e%2E/a.mp3' } } }, /relative local path/],
    [{ format: 'audio/mpeg', readings: { a: { file: 'assets/%00audio/a.mp3' } } }, /relative local path/],
    [{ format: 'audio/mpeg', readings: { a: { file: 'assets/%0Aaudio/a.mp3' } } }, /relative local path/],
    [{ format: 'audio/mpeg', readings: { a: { file: 'assets/%7faudio/a.mp3' } } }, /relative local path/],
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
