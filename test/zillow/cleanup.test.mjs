import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HandoffStore, handoff } from '../../scripts/zillow/handoff.mjs';

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'zillow-cleanup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new HandoffStore(directory);
  let failClose = true;
  let reads = 0;
  const result = { status: 'complete', result: { monthlyRent: 1650 } };
  const manage = args => {
    if (args[0] === 'close' && failClose) throw new Error('ENOTEMPTY');
    return 'b-abc';
  };
  const run = () => { reads++; return result; };
  return { store, manage, run, result, reads: () => reads, allowCleanup: () => { failClose = false; } };
}

test('shutdown failure returns completed evidence; resume retries only cleanup', t => {
  const fixture = setup(t);
  const output = handoff({ operation: 'property', url: 'https://www.zillow.com/homedetails/example/123_zpid/' }, fixture);
  assert.equal(output.status, 'complete');
  assert.deepEqual(output.result, fixture.result.result);
  assert.equal(output.cleanup.status, 'pending');
  const token = output.cleanup.recoveryHandle;
  assert.deepEqual(fixture.store.load(token).completedResult, fixture.result);
  assert.equal(fixture.store.load(token).targetId, null);
  assert.equal(handoff({ token }, fixture).cleanup.status, 'pending');
  assert.equal(fixture.reads(), 1);
  fixture.allowCleanup();
  assert.deepEqual(handoff({ token }, fixture), fixture.result);
  assert.equal(fixture.reads(), 1);
  assert.throws(() => fixture.store.load(token), /ENOENT/);
});

test('cancel after completed-read shutdown failure discards evidence without another read', t => {
  const fixture = setup(t);
  const output = handoff({ operation: 'listing', url: 'https://www.zillow.com/homedetails/example/123_zpid/' }, fixture);
  const token = output.cleanup.recoveryHandle;
  assert.throws(() => handoff({ token, cancel: true }, fixture), /ENOTEMPTY/);
  assert(fixture.store.load(token).completedResult);
  fixture.allowCleanup();
  assert.deepEqual(handoff({ token, cancel: true }, fixture), { status: 'cancelled' });
  assert.equal(fixture.reads(), 1);
  assert.throws(() => fixture.store.load(token), /ENOENT/);
});
