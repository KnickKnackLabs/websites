import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handoff } from '../../scripts/zillow/handoff.mjs';
import { HandoffStore } from '../../scripts/zillow/handoff-store.mjs';
import { findOwnedPage, intervene } from '../../scripts/zillow/intervention.mjs';

const LISTING_URL = 'https://www.zillow.com/homedetails/example/123_zpid/';
const SAVED_TOKEN = 'a'.repeat(48);

function privateStore(t) {
  const directory = mkdtempSync(join(tmpdir(), 'zillow-handoff-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return new HandoffStore(join(directory, 'private'));
}

function parkedHandoff(t) {
  const store = privateStore(t);
  store.save(SAVED_TOKEN, {
    version: 1,
    operation: 'listing',
    url: LISTING_URL,
    calculator: true,
    browser: 'b-abc',
    targetId: 'owned',
  });
  return store;
}

function browserCommands() {
  const calls = [];
  return {
    calls,
    manage(args) {
      calls.push(args);
      return 'b-abc';
    },
  };
}

function challengedRead() {
  return { status: 'needs_human', targetId: 'owned', challengeUrl: LISTING_URL };
}

function brokenRead() {
  throw new Error('runtime broke');
}

test('launch saves private browser and exact challenge target', t => {
  const store = privateStore(t);
  const commands = browserCommands();

  const result = handoff({ operation: 'listing', url: LISTING_URL, calculator: true }, {
    store,
    manage: commands.manage,
    run: challengedRead,
  });

  assert.equal(result.status, 'needs_human');
  assert.equal(statSync(store.directory).mode & 0o777, 0o700);
  assert.equal(statSync(store.path(result.resumeHandle)).mode & 0o777, 0o600);
  assert.equal(store.load(result.resumeHandle).targetId, 'owned');
  assert.equal(store.load(result.resumeHandle).calculator, true);
  assert.deepEqual(commands.calls, [['launch', '--temporary', '--headed']]);
});

test('unit calculator intervention saves and resumes the original unit selection', t => {
  const store = privateStore(t);
  const url = 'https://www.zillow.com/apartments/example-city/example-building/AbCd/';
  let resumedRecord;
  const parked = handoff({ operation: 'property', url, calculator: true, unit: '42' }, {
    store,
    manage: browserCommands().manage,
    run: challengedRead,
  });
  assert.equal(store.load(parked.resumeHandle).unit, '42');

  handoff({ token: parked.resumeHandle }, {
    store,
    manage: browserCommands().manage,
    run: (_script, args) => {
      resumedRecord = JSON.parse(args[1]);
      return { status: 'complete', result: { calculator: {} } };
    },
  });
  assert.equal(resumedRecord.unit, '42');
  assert.equal(resumedRecord.calculator, true);
  assert.equal(resumedRecord.url, url);
});

test('still-challenged resume preserves the same handle and exact target', t => {
  const store = parkedHandoff(t);
  let receivedRecord;
  const run = (_script, args) => {
    receivedRecord = JSON.parse(args[1]);
    assert.equal(args[0], 'read');
    return challengedRead();
  };

  const result = handoff({ token: SAVED_TOKEN }, {
    store,
    manage: browserCommands().manage,
    run,
  });

  assert.equal(result.resumeHandle, SAVED_TOKEN);
  assert.equal(receivedRecord.targetId, 'owned');
  assert.equal(receivedRecord.calculator, true);
});

test('completed resume closes the dedicated browser and consumes the handle', t => {
  const store = parkedHandoff(t);
  const commands = browserCommands();
  const result = handoff({ token: SAVED_TOKEN }, {
    store,
    manage: commands.manage,
    run: () => ({ status: 'complete', result: { listing: {} } }),
  });

  assert.equal(result.status, 'complete');
  assert.deepEqual(commands.calls, [['close', 'b-abc']]);
  assert.throws(() => store.load(SAVED_TOKEN), /ENOENT/);
});

test('failed initial read retains its launched browser record for recovery', t => {
  const store = privateStore(t);
  const commands = browserCommands();

  assert.throws(() => handoff({
    operation: 'listing', url: LISTING_URL, token: SAVED_TOKEN,
  }, {
    store,
    manage: commands.manage,
    run: brokenRead,
  }), /runtime broke/);

  assert.equal(store.load(SAVED_TOKEN).browser, 'b-abc');
  assert.deepEqual(commands.calls, [['launch', '--temporary', '--headed']]);
});

test('failed resumed read retains recovery state', t => {
  const store = parkedHandoff(t);
  assert.throws(() => handoff({ token: SAVED_TOKEN }, {
    store,
    manage: browserCommands().manage,
    run: brokenRead,
  }), /runtime broke/);
  assert.equal(store.load(SAVED_TOKEN).targetId, 'owned');
});

test('a locked handle cannot run a second operation', t => {
  const store = parkedHandoff(t);
  const unlock = store.lock(SAVED_TOKEN);
  try {
    assert.throws(() => handoff({ token: SAVED_TOKEN }, {
      store,
      manage: () => assert.fail('must not manage a browser while locked'),
      run: () => assert.fail('must not read while locked'),
    }), /EEXIST/);
  } finally {
    unlock();
  }
});

test('cancellation closes the owned target before dedicated-browser cleanup', t => {
  const store = parkedHandoff(t);
  const commands = browserCommands();
  const result = handoff({ token: SAVED_TOKEN, cancel: true }, {
    store,
    manage: commands.manage,
    run: (_script, args) => {
      assert.equal(args[0], 'cancel');
      return { status: 'cancelled' };
    },
  });

  assert.equal(result.status, 'cancelled');
  assert.deepEqual(commands.calls, [['close', 'b-abc']]);
  assert.throws(() => store.load(SAVED_TOKEN), /ENOENT/);
});

test('handles reject caller-supplied paths', t => {
  assert.throws(() => privateStore(t).path('../bad'), /Invalid/);
});

// Stub only CDP transport and page lifecycle. DOM extraction is exercised in
// listing-dom.test.mjs with real Chromium, not a hand-built document object.
function pageTransport({ challenged = true } = {}) {
  const events = [];
  const human = {
    targetId: 'human',
    close: async () => events.push('close human'),
  };
  const owned = {
    targetId: 'owned',
    goto: async () => events.push('navigate owned'),
    close: async () => events.push('close owned'),
  };
  const snapshot = challenged
    ? { url: LISTING_URL, title: 'Access to this page has been denied', text: 'Press & Hold' }
    : { url: LISTING_URL, title: 'Rental', text: 'Rental facts', properties: [{ zpid: 123 }], photos: [] };

  const context = {
    pages: () => [human, owned],
    newPage: async () => owned,
    newCDPSession: async page => ({
      detach: async () => events.push(`detach ${page.targetId}`),
      send: async method => {
        if (method === 'Target.getTargetInfo') {
          return { targetInfo: { targetId: page.targetId } };
        }
        return { result: { value: JSON.stringify(snapshot) } };
      },
    }),
  };
  return { context, owned, events };
}

test('exact target selection never falls back to a human tab', async () => {
  const transport = pageTransport();
  assert.equal(await findOwnedPage(transport.context, 'owned'), transport.owned);
  await assert.rejects(findOwnedPage(transport.context, 'gone'), /no other tab/);
  assert(!transport.events.includes('close human'));
});

test('initial challenge retains the new owned tab', async () => {
  const transport = pageTransport();
  const result = await intervene(transport.context, { operation: 'listing', url: LISTING_URL });
  assert.equal(result.status, 'needs_human');
  assert.equal(result.targetId, 'owned');
  assert(transport.events.includes('navigate owned'));
  assert(!transport.events.includes('close owned'));
});

test('still-challenged resume leaves the owned tab in place without navigation', async () => {
  const transport = pageTransport();
  const result = await intervene(transport.context, {
    operation: 'listing', url: LISTING_URL, targetId: 'owned',
  });
  assert.equal(result.status, 'needs_human');
  assert(!transport.events.includes('navigate owned'));
  assert(!transport.events.includes('close owned'));
});

test('solved resume reads in place and closes only the owned tab', async () => {
  const transport = pageTransport({ challenged: false });
  const result = await intervene(transport.context, {
    operation: 'listing', url: LISTING_URL, targetId: 'owned',
  });
  assert.equal(result.status, 'complete');
  assert(transport.events.includes('close owned'));
  assert(!transport.events.includes('navigate owned'));
  assert(!transport.events.includes('close human'));
});
