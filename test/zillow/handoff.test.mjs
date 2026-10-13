import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HandoffStore, handoff, managedBrowser } from '../../scripts/zillow/handoff.mjs';
import { findOwnedPage, intervene } from '../../scripts/zillow/intervention.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'zillow-handoff-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new HandoffStore(join(dir, 'private'));
}
const url = 'https://www.zillow.com/homedetails/example/123_zpid/';

test('managed launch inherits stderr so detached workers cannot retain a captured pipe', () => {
  assert.equal(managedBrowser(['launch', '--temporary', '--headed'], (_command, args, options) => {
    assert.deepEqual(args, ['launch', '--temporary', '--headed']);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'inherit']);
    return { status: 0, stdout: 'b-abc\n' };
  }), 'b-abc');
});

test('private handle persists exact target, reparks, resumes and closes dedicated browser', t => {
  const store = fixture(t);
  const calls = [];
  const manage = args => { calls.push(args); return 'b-abc-123'; };
  let response = { status: 'needs_human', targetId: 'owned', challengeUrl: url };
  const run = (_script, args, opts) => {
    calls.push({ record: JSON.parse(args[1]), mode: args[0], opts });
    return response;
  };
  const parked = handoff({ operation: 'listing', url, calculator: true }, { store, manage, run });
  assert.equal(parked.status, 'needs_human');
  const token = parked.resumeHandle;
  assert.equal(statSync(store.path(token)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(store.path(token))).targetId, 'owned');
  assert.equal(handoff({ token }, { store, manage, run }).resumeHandle, token);
  assert.equal(calls.at(-1).record.targetId, 'owned');
  response = { status: 'complete', result: { listing: {} } };
  assert.equal(handoff({ token }, { store, manage, run }).status, 'complete');
  assert.deepEqual(calls.at(-1), ['close', 'b-abc-123']);
  assert.throws(() => store.load(token), /ENOENT/);
});

test('errors retain recovery state; cancel consumes handle; concurrent operations rejected', t => {
  const store = fixture(t);
  const manage = () => 'b-abc';
  const run = () => { throw new Error('runtime broke'); };
  assert.throws(() => handoff({ operation: 'listing', url }, { store, manage, run }), /runtime broke/);
  const token = 'a'.repeat(48);
  store.save(token, { version: 1, operation: 'listing', url, browser: 'b-abc', targetId: 'owned' });
  const unlock = store.lock(token);
  assert.throws(() => handoff({ token }, { store, manage, run }), /EEXIST/);
  unlock();
  assert.throws(() => handoff({ token }, { store, manage, run }), /runtime broke/);
  assert.equal(store.load(token).targetId, 'owned');
  const cancelled = handoff({ token, cancel: true }, { store, manage, run: (_s, args) => {
    assert.equal(args[0], 'cancel'); return { status: 'cancelled' };
  } });
  assert.equal(cancelled.status, 'cancelled');
  assert.throws(() => store.path('../bad'), /Invalid/);
});

function mockContext({ challenge = true } = {}) {
  const events = [];
  const human = { name: 'human', close: async () => events.push('CLOSED HUMAN') };
  const owned = { name: 'owned', goto: async () => events.push('goto'), close: async () => events.push('close owned') };
  const context = {
    pages: () => [human, owned],
    newPage: async () => { events.push('new'); return owned; },
    newCDPSession: async page => ({
      detach: async () => events.push(`detach ${page.name}`),
      send: async method => {
        if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: page.name } };
        const snapshot = challenge ? { url, title: 'Access to this page has been denied', text: 'Press & Hold' }
          : { url, title: 'Rental', text: 'Rental facts', properties: [{ zpid: 123 }], photos: [] };
        return { result: { value: JSON.stringify(snapshot) } };
      },
    }),
  };
  return { context, owned, events };
}

test('exact target selection never falls back to human tab', async () => {
  const { context, owned, events } = mockContext();
  assert.equal(await findOwnedPage(context, 'owned'), owned);
  await assert.rejects(findOwnedPage(context, 'gone'), /no other tab/);
  assert(!events.includes('CLOSED HUMAN'));
});

test('challenge parks; still challenged resume reparks without navigation; solved resume cleans up', async () => {
  for (const resumed of [false, true]) {
    const { context, events } = mockContext();
    const result = await intervene(context, { operation: 'listing', url, targetId: resumed ? 'owned' : null });
    assert.equal(result.status, 'needs_human');
    assert.equal(result.targetId, 'owned');
    assert(!events.includes('close owned'));
    assert.equal(events.includes('goto'), !resumed);
  }
  const { context, events } = mockContext({ challenge: false });
  const result = await intervene(context, { operation: 'listing', url, targetId: 'owned' });
  assert.equal(result.status, 'complete');
  assert(events.includes('close owned'));
  assert(!events.includes('goto'));
  assert(!events.includes('CLOSED HUMAN'));
});
