import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('listing page extraction and controls work against synthetic HTML in Chromium', () => {
  const fixture = fileURLToPath(new URL('./fixtures/listing-dom.mjs', import.meta.url));
  const output = execFileSync('browser', ['run', fixture], {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // The harness prints a preamble; the fixture prints one JSON receipt last.
  const receipt = JSON.parse(output.trim().split('\n').at(-1));
  assert(receipt.passedScenarios.includes('inline calculator excludes neighboring properties'));
  assert(receipt.passedScenarios.includes('scoped policies preserve nested facts'));
  assert(receipt.passedScenarios.includes('calculator click ignores hidden controls'));
});
