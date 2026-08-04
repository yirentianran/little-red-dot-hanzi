import assert from 'node:assert/strict';
import test from 'node:test';
import { scanSensitiveContent } from '../scripts/scan-sensitive-content.mjs';

test('current source passes the sensitive-content release scan', async () => {
  assert.deepEqual(await scanSensitiveContent(), []);
});
