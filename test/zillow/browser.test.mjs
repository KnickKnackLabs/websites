import test from 'node:test';
import assert from 'node:assert/strict';
import {
  zillowUrl,
  evaluateJSON,
  withOwnedTab,
  HumanVerificationRequired,
} from '../../scripts/zillow/browser.mjs';

const invalidUrls = [
  { name: 'HTTP', url: 'http://www.zillow.com' },
  { name: 'lookalike host', url: 'https://zillow.com.evil.test' },
  { name: 'unrelated host', url: 'https://evil.test' },
  { name: 'credentials', url: 'https://user@zillow.com' },
  { name: 'nonstandard port', url: 'https://zillow.com:8443' },
];
for (const scenario of invalidUrls) {
  test(`Zillow URL rejects ${scenario.name}`, () => {
    assert.throws(() => zillowUrl(scenario.url));
  });
}

test('relative Zillow detail URL resolves against an explicit Zillow base', () => {
  const url = zillowUrl('/homedetails/x/1_zpid/', 'https://www.zillow.com');
  assert.equal(url.hostname, 'www.zillow.com');
});

function responseSession(response) {
  return { send: async () => response };
}
function snapshotSession(snapshot) {
  return responseSession({ result: { value: JSON.stringify(snapshot) } });
}

const invalidResponses = [
  { name: 'Runtime exception', response: { exceptionDetails: {}, result: { value: '{}' } } },
  { name: 'missing value', response: {} },
  { name: 'malformed JSON', response: { result: { value: '{' } } },
  { name: 'null snapshot', response: { result: { value: 'null' } } },
];
for (const scenario of invalidResponses) {
  test(`CDP rejects ${scenario.name}`, async () => {
    await assert.rejects(evaluateJSON(responseSession(scenario.response), () => '{}'));
  });
}

const challenges = [
  { name: 'verification text', snapshot: { text: 'Press and hold to verify you are human' } },
  { name: 'live Press & Hold wording', snapshot: { text: 'Press & Hold to confirm you are\na human (and not a bot).' } },
  { name: 'access-denied title', snapshot: { title: 'Access to this page has been denied', text: '' } },
];
for (const scenario of challenges) {
  test(`CDP detects ${scenario.name}`, async () => {
    await assert.rejects(evaluateJSON(snapshotSession(scenario.snapshot), () => '{}'), /challenge encountered/);
  });
}

test('CDP returns ordinary source evidence', async () => {
  const result = await evaluateJSON(snapshotSession({ text: 'ok' }), () => '{}');
  assert.equal(result.text, 'ok');
});

function tabLifecycle({ setupFails = false, detachFails = false, closeFails = false } = {}) {
  const events = [];
  const page = {
    close: async () => {
      events.push('close');
      if (closeFails) throw new Error('close broke');
    },
  };
  const session = {
    detach: async () => {
      events.push('detach');
      if (detachFails) throw new Error('detach broke');
    },
  };
  const context = {
    newPage: async () => page,
    newCDPSession: async () => {
      if (setupFails) throw new Error('setup broke');
      return session;
    },
  };
  return { context, events };
}

async function successfulRead() {
  return 42;
}
async function failedRead() {
  throw new Error('read broke');
}
async function challengedRead() {
  throw new HumanVerificationRequired({ url: 'https://www.zillow.com/' });
}
async function humanHandoff() {
  return { status: 'needs_human' };
}

test('successful owned read cleans up before returning its value', async () => {
  const lifecycle = tabLifecycle();
  assert.equal(await withOwnedTab(lifecycle.context, successfulRead), 42);
  assert.deepEqual(lifecycle.events, ['detach', 'close']);
});

test('failed CDP setup still closes the owned tab', async () => {
  const lifecycle = tabLifecycle({ setupFails: true });
  await assert.rejects(withOwnedTab(lifecycle.context, successfulRead), /setup broke/);
  assert.deepEqual(lifecycle.events, ['close']);
});

test('failed read detaches and closes the owned tab', async () => {
  const lifecycle = tabLifecycle();
  await assert.rejects(withOwnedTab(lifecycle.context, failedRead), /read broke/);
  assert.deepEqual(lifecycle.events, ['detach', 'close']);
});

const cleanupFailures = [
  { name: 'detach', options: { detachFails: true } },
  { name: 'close', options: { closeFails: true } },
  { name: 'detach and close', options: { detachFails: true, closeFails: true } },
];
for (const scenario of cleanupFailures) {
  test(`owned read reports ${scenario.name} failure and attempts both cleanup steps`, async () => {
    const lifecycle = tabLifecycle(scenario.options);
    await assert.rejects(withOwnedTab(lifecycle.context, successfulRead), /cleanup failed/);
    assert.deepEqual(lifecycle.events, ['detach', 'close']);
  });
}

test('explicit human handoff retains the challenge tab but detaches CDP', async () => {
  const lifecycle = tabLifecycle();
  const result = await withOwnedTab(lifecycle.context, challengedRead, { onChallenge: humanHandoff });
  assert.equal(result.status, 'needs_human');
  assert.deepEqual(lifecycle.events, ['detach']);
});

test('failed handoff closes the challenge tab', async () => {
  const lifecycle = tabLifecycle();
  await assert.rejects(withOwnedTab(lifecycle.context, challengedRead, {
    onChallenge: async () => { throw new Error('handoff failed'); },
  }), /handoff failed/);
  assert.deepEqual(lifecycle.events, ['detach', 'close']);
});

test('ordinary read failures never invoke the human handoff', async () => {
  const lifecycle = tabLifecycle();
  await assert.rejects(withOwnedTab(lifecycle.context, failedRead, {
    onChallenge: async () => assert.fail('must not park ordinary failures'),
  }), /read broke/);
  assert.deepEqual(lifecycle.events, ['detach', 'close']);
});

test('detach failure while parking closes the challenge tab instead of claiming handoff', async () => {
  const lifecycle = tabLifecycle({ detachFails: true });
  await assert.rejects(withOwnedTab(lifecycle.context, challengedRead, {
    onChallenge: humanHandoff,
  }), /cleanup failed/);
  assert.deepEqual(lifecycle.events, ['detach', 'close']);
});
