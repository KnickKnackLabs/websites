import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBrowserResult,
  runBrowser,
  managedBrowser,
  RESULT_PREFIX,
} from '../../scripts/zillow/browser-command.mjs';

const SUCCESS_FRAME = `${RESULT_PREFIX}{"ok":true}`;

test('framed output separates browser preamble from evidence', () => {
  assert.deepEqual(parseBrowserResult(`preamble\n${SUCCESS_FRAME}\n`), { ok: true });
});

const invalidFrames = [
  { name: 'missing result', stdout: '' },
  { name: 'duplicate results', stdout: `${SUCCESS_FRAME}\n${SUCCESS_FRAME}` },
  { name: 'malformed JSON', stdout: `${RESULT_PREFIX}invalid` },
];
for (const scenario of invalidFrames) {
  test(`result transport rejects ${scenario.name}`, () => {
    assert.throws(() => parseBrowserResult(scenario.stdout));
  });
}

test('browser runner passes explicit browser and headed flags', () => {
  let command;
  const result = runBrowser('/script.mjs', ['url'], {
    browser: 'b-test',
    headed: true,
    spawn: (_executable, args) => {
      command = args;
      return { status: 0, stdout: SUCCESS_FRAME, stderr: '' };
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(command, ['run', '--browser', 'b-test', '--headed', '/script.mjs', 'url']);
});

test('a failed process cannot return success even with a valid result frame', () => {
  assert.throws(() => runBrowser('script', [], {
    spawn: () => ({ status: 1, stdout: SUCCESS_FRAME }),
  }), /failed/);
});

test('a successful process without a result still fails', () => {
  assert.throws(() => runBrowser('script', [], {
    spawn: () => ({ status: 0, stdout: '' }),
  }), /Expected one/);
});

test('managed launch inherits stderr so detached workers cannot retain a captured pipe', () => {
  const browserId = managedBrowser(['launch', '--temporary', '--headed'], (_command, args, options) => {
    assert.deepEqual(args, ['launch', '--temporary', '--headed']);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'inherit']);
    return { status: 0, stdout: 'b-abc\n' };
  });
  assert.equal(browserId, 'b-abc');
});
