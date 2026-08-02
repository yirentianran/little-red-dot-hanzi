import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('defines a self-contained Kotlin Android application and Gradle wrapper', async () => {
  const [settings, rootBuild, appBuild, wrapper] = await Promise.all([
    source('android/settings.gradle'),
    source('android/build.gradle'),
    source('android/app/build.gradle'),
    source('android/gradle/wrapper/gradle-wrapper.properties')
  ]);

  assert.match(settings, /google\(\)/);
  assert.match(settings, /mavenCentral\(\)/);
  assert.match(rootBuild, /com\.android\.application/);
  assert.match(rootBuild, /org\.jetbrains\.kotlin\.android/);
  assert.match(appBuild, /namespace\s+['"]com\.littlereddot\.hanzi['"]/);
  assert.match(appBuild, /compileSdk\s+32/);
  assert.match(appBuild, /minSdk\s+23/);
  assert.match(appBuild, /targetSdk\s+32/);
  assert.match(appBuild, /versionCode\s+3/);
  assert.match(appBuild, /versionName\s+['"]1\.0\.2['"]/);
  assert.match(wrapper, /gradle-7\.4-bin\.zip/);
});

test('packages every offline runtime asset from the web project', async () => {
  const appBuild = await source('android/app/build.gradle');

  for (const asset of [
    'index.html',
    'styles.css',
    'js/**',
    'data/library-data.js',
    'vendor/**',
    'assets/audio/**'
  ]) {
    assert.match(appBuild, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(appBuild, /syncWebAssets/);
  assert.match(appBuild, /preBuild/);
});

test('hosts the local app through a persistent and restricted HTTPS asset origin', async () => {
  const [manifest, appBuild, activity] = await Promise.all([
    source('android/app/src/main/AndroidManifest.xml'),
    source('android/app/build.gradle'),
    source('android/app/src/main/java/com/littlereddot/hanzi/MainActivity.kt')
  ]);

  assert.doesNotMatch(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:exported="true"/);
  assert.match(manifest, /android:screenOrientation="sensorLandscape"/);
  assert.match(appBuild, /androidx\.webkit:webkit:1\.5\.0/);
  assert.match(activity, /javaScriptEnabled\s*=\s*true/);
  assert.match(activity, /domStorageEnabled\s*=\s*true/);
  assert.match(activity, /allowFileAccess\s*=\s*false/);
  assert.match(activity, /allowUniversalAccessFromFileURLs\s*=\s*false/);
  assert.match(activity, /mediaPlaybackRequiresUserGesture\s*=\s*true/);
  assert.match(activity, /WebViewAssetLoader/);
  assert.match(activity, /https:\/\/appassets\.androidplatform\.net\/assets\/web\/index\.html/);
  assert.doesNotMatch(activity, /file:\/\/\/android_asset/);
  assert.match(activity, /restoreState/);
  assert.match(activity, /canGoBack\(\)/);
  assert.match(activity, /webView\.destroy\(\)/);
});

test('loads the WebView compatibility layer before application scripts', async () => {
  const [page, compatibility] = await Promise.all([
    source('index.html'),
    source('js/compat.js')
  ]);

  const compatibilityIndex = page.indexOf('src="js/compat.js"');
  const dataIndex = page.indexOf('src="data/library-data.js"');
  assert.notEqual(compatibilityIndex, -1);
  assert.ok(compatibilityIndex < dataIndex);
  assert.match(compatibility, /typeof global\.Object\.hasOwn !== ['"]function['"]/);
  assert.match(compatibility, /hasOwnProperty\.call/);
});

test('documents Android building and keeps generated output out of git', async () => {
  const [readme, ignore, strings] = await Promise.all([
    source('README.md'),
    source('android/.gitignore'),
    source('android/app/src/main/res/values/strings.xml')
  ]);

  assert.match(readme, /Android/);
  assert.match(readme, /assembleDebug/);
  assert.match(ignore, /build\//);
  assert.match(ignore, /local\.properties/);
  assert.match(strings, /小红点识字/);
});
