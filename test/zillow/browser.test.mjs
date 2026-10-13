import test from 'node:test';
import assert from 'node:assert/strict';
import { zillowUrl, evaluateJSON, withOwnedTab, HumanVerificationRequired } from '../../scripts/zillow/browser.mjs';
import { parseBrowserResult, runBrowser, RESULT_PREFIX } from '../../scripts/zillow/task.mjs';

test('Zillow URLs reject other sites, credentials, ports and HTTP', () => {
  assert.equal(zillowUrl('/homedetails/x/1_zpid/', 'https://www.zillow.com').hostname, 'www.zillow.com');
  for (const url of ['http://www.zillow.com', 'https://zillow.com.evil.test', 'https://evil.test', 'https://user@zillow.com', 'https://zillow.com:8443']) assert.throws(() => zillowUrl(url));
});

test('CDP validates exceptions, absent values, malformed JSON and challenges', async () => {
  for (const response of [{ exceptionDetails: {}, result: { value: '{}' } }, {}, { result: { value: '{' } }, { result: { value: 'null' } }, { result: { value: JSON.stringify({ text: 'Press and hold to verify you are human' }) } }]) {
    await assert.rejects(evaluateJSON({ send: async () => response }, () => '{}'));
  }
  for (const snapshot of [{ text: 'Press & Hold to confirm you are\na human (and not a bot).' }, { title: 'Access to this page has been denied', text: '' }]) {
    await assert.rejects(evaluateJSON({ send: async () => ({ result: { value: JSON.stringify(snapshot) } }) }, () => '{}'), /challenge encountered/);
  }
  const result = await evaluateJSON({ send: async () => ({ result: { value: '{"text":"ok"}' } }) }, () => '{}');
  assert.equal(result.text, 'ok');
});

function lifecycle({ setup = false, detach = false, close = false } = {}) {
  const events = [];
  const page = { close: async () => { events.push('close'); if (close) throw new Error('close broke'); } };
  const session = { detach: async () => { events.push('detach'); if (detach) throw new Error('detach broke'); } };
  const context = { newPage: async () => page, newCDPSession: async () => { if (setup) throw new Error('setup broke'); return session; } };
  return { events, context };
}

test('owned-tab cleanup completes before success and on failed CDP setup/read/detach', async () => {
  const ok = lifecycle();
  assert.equal(await withOwnedTab(ok.context, async () => 42), 42);
  assert.deepEqual(ok.events, ['detach', 'close']);
  const setup = lifecycle({ setup: true });
  await assert.rejects(withOwnedTab(setup.context, async () => 42), /setup broke/);
  assert.deepEqual(setup.events, ['close']);
  const read = lifecycle();
  await assert.rejects(withOwnedTab(read.context, async () => { throw new Error('read broke'); }), /read broke/);
  assert.deepEqual(read.events, ['detach', 'close']);
  for (const options of [{ detach: true }, { close: true }, { detach: true, close: true }]) {
    const broken = lifecycle(options);
    await assert.rejects(withOwnedTab(broken.context, async () => 42), /cleanup failed/);
    assert.deepEqual(broken.events, ['detach', 'close']);
  }
});

test('explicit human handoff retains only challenge tabs and detaches CDP', async () => {
  const paused = lifecycle();
  const result = await withOwnedTab(paused.context, async () => {
    throw new HumanVerificationRequired({ url: 'https://www.zillow.com/' });
  }, { onChallenge: async () => ({ status: 'needs_human' }) });
  assert.equal(result.status, 'needs_human');
  assert.deepEqual(paused.events, ['detach']);
  const broken = lifecycle();
  await assert.rejects(withOwnedTab(broken.context, async () => {
    throw new HumanVerificationRequired({});
  }, { onChallenge: async () => { throw new Error('handoff failed'); } }), /handoff failed/);
  assert.deepEqual(broken.events, ['detach', 'close']);
  const normal = lifecycle();
  await assert.rejects(withOwnedTab(normal.context, async () => { throw new Error('ordinary failure'); }, {
    onChallenge: async () => assert.fail('must not park ordinary failures'),
  }), /ordinary failure/);
  assert.deepEqual(normal.events, ['detach', 'close']);
  const detach = lifecycle({ detach: true });
  await assert.rejects(withOwnedTab(detach.context, async () => { throw new HumanVerificationRequired({}); }, {
    onChallenge: async () => ({ status: 'needs_human' }),
  }), /cleanup failed/);
  assert.deepEqual(detach.events, ['detach', 'close']);
});

test('browser transport needs exactly one valid framed result and a successful process', () => {
  assert.deepEqual(parseBrowserResult(`preamble\n${RESULT_PREFIX}{"ok":true}\n`), { ok: true });
  for (const text of ['', `${RESULT_PREFIX}{}\n${RESULT_PREFIX}{}`, `${RESULT_PREFIX}invalid`]) assert.throws(() => parseBrowserResult(text));
  let invocation;
  const result = runBrowser('/script.mjs', ['url'], { browser: 'b-test', headed: true, spawn: (...args) => {
    invocation = args;
    return { status: 0, stdout: `${RESULT_PREFIX}{"ok":true}`, stderr: '' };
  } });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(invocation[1], ['run', '--browser', 'b-test', '--headed', '/script.mjs', 'url']);
  assert.throws(() => runBrowser('script', [], { spawn: () => ({ status: 1, stdout: `${RESULT_PREFIX}{}` }) }), /failed/);
  assert.throws(() => runBrowser('script', [], { spawn: () => ({ status: 0, stdout: '' }) }), /Expected one/);
});
