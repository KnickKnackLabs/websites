import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runBrowser, managedBrowser } from './browser-command.mjs';
import { HandoffStore } from './handoff-store.mjs';

const INTERVENTION_SCRIPT = fileURLToPath(new URL('./intervention.mjs', import.meta.url));

function launchHandoff(request, token, { store, manage }) {
  const browser = manage(['launch', '--temporary', '--headed']);
  if (!/^b-[a-f0-9-]+$/.test(browser)) {
    throw new Error('Unexpected managed browser ID');
  }

  const record = {
    version: 1,
    operation: request.operation,
    url: request.url,
    calculator: request.calculator ?? false,
    browser,
    targetId: null,
    created: new Date().toISOString(),
  };
  try {
    store.save(token, record);
  } catch (error) {
    manage(['close', browser]);
    throw error;
  }
  return record;
}

function parkForHuman(result, record, token, store) {
  if (typeof result.targetId !== 'string' || !result.targetId) {
    throw new Error('Missing challenge target');
  }
  record.targetId = result.targetId;
  store.save(token, record);

  return {
    status: 'needs_human',
    resumeHandle: token,
    browser: record.browser,
    challengeUrl: result.challengeUrl,
    instruction: 'Ask the human to solve verification in the visible Zillow tab, then run websites zillow intervention resume with this handle. Do not automate solving.',
  };
}

function finishHandoff(result, record, token, { store, manage }) {
  // Save evidence before shutdown so cleanup retries never repeat the read.
  if (result.status === 'complete') {
    record.completedResult = result;
    record.targetId = null; // The reader already closed its owned tab.
    store.save(token, record);
  }

  try {
    manage(['close', record.browser]);
  } catch (error) {
    if (result.status !== 'complete') throw error;
    process.stderr.write(`Zillow read completed; browser cleanup pending: ${error.message}\n`);
    return {
      ...result,
      cleanup: {
        status: 'pending',
        browser: record.browser,
        recoveryHandle: token,
        error: error.message,
      },
    };
  }

  store.remove(token);
  return result;
}

function continueHandoff(request, record, token, dependencies) {
  const { store, run } = dependencies;

  if (record.completedResult) {
    if (record.completedResult.status !== 'complete') {
      throw new Error('Invalid stored completed result');
    }
    const result = request.cancel ? { status: 'cancelled' } : record.completedResult;
    return finishHandoff(result, record, token, dependencies);
  }

  if (request.cancel && !record.targetId) {
    return finishHandoff({ status: 'cancelled' }, record, token, dependencies);
  }

  const action = request.cancel ? 'cancel' : 'read';
  const result = run(INTERVENTION_SCRIPT, [action, JSON.stringify(record)], {
    browser: record.browser,
  });
  if (result.status === 'needs_human') {
    return parkForHuman(result, record, token, store);
  }
  if (!['complete', 'cancelled'].includes(result.status)) {
    throw new Error('Unexpected intervention result');
  }
  return finishHandoff(result, record, token, dependencies);
}

export function handoff(request, {
  store = new HandoffStore(),
  manage = managedBrowser,
  run = runBrowser,
} = {}) {
  const token = request.token || randomBytes(24).toString('hex');
  const dependencies = { store, manage, run };
  const unlock = store.lock(token);

  try {
    const record = request.operation
      ? launchHandoff(request, token, dependencies)
      : store.load(token);

    // Errors retain the saved handle/browser, so always expose recovery details.
    process.stderr.write(`Zillow intervention browser: ${record.browser}; recovery handle: ${token}\n`);
    return continueHandoff(request, record, token, dependencies);
  } finally {
    unlock();
  }
}
