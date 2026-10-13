import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runBrowser } from './task.mjs';

const script = fileURLToPath(new URL('./intervention.mjs', import.meta.url));
export function managedBrowser(command, spawn = spawnSync) {
  // Detached managed-browser workers inherit stderr. A captured stderr pipe
  // would stay open after launch exits, making spawnSync hang until timeout.
  const result = spawn('browser', command, { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`browser ${command[0]} failed (${result.status}); recovery may require browser close`);
  return result.stdout.trim();
}

// Private local capabilities, never arbitrary filenames supplied by a caller.
export class HandoffStore {
  constructor(directory = join(homedir(), '.local', 'state', 'websites', 'zillow')) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  path(token) {
    if (!/^[a-f0-9]{48}$/.test(token)) throw new Error('Invalid Zillow resume handle');
    return join(this.directory, `${token}.json`);
  }
  save(token, record) {
    const path = this.path(token);
    const temporary = `${path}.${randomBytes(8).toString('hex')}`;
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  }
  load(token) {
    const record = JSON.parse(readFileSync(this.path(token), 'utf8'));
    if (record.version !== 1 || !/^b-[a-f0-9-]+$/.test(record.browser) || !['search', 'listing', 'property'].includes(record.operation)) throw new Error('Invalid stored Zillow handoff');
    return record;
  }
  remove(token) { unlinkSync(this.path(token)); }
  lock(token) {
    const path = `${this.path(token)}.lock`;
    mkdirSync(path, { mode: 0o700 });
    return () => rmdirSync(path);
  }
}

export function handoff({ operation, url, calculator = false, token, cancel = false }, {
  store = new HandoffStore(), manage = managedBrowser, run = runBrowser,
} = {}) {
  if (!token) token = randomBytes(24).toString('hex');
  const unlock = store.lock(token);
  let record;
  try {
    if (operation) {
      const browser = manage(['launch', '--temporary', '--headed']);
      if (!/^b-[a-f0-9-]+$/.test(browser)) throw new Error('Unexpected managed browser ID');
      record = { version: 1, operation, url, calculator, browser, targetId: null, created: new Date().toISOString() };
      try { store.save(token, record); }
      catch (error) { manage(['close', browser]); throw error; }
    } else record = store.load(token);
    // On unexpected errors retain the private handle and browser for recovery.
    process.stderr.write(`Zillow intervention browser: ${record.browser}; recovery handle: ${token}\n`);
    const finish = result => {
      // Persist completed evidence before closing: a shutdown failure or an
      // interrupted process must not force another network read.
      if (result.status === 'complete') {
        record.completedResult = result;
        record.targetId = null; // The reader already closed its owned tab.
        store.save(token, record);
      }
      try { manage(['close', record.browser]); }
      catch (error) {
        if (result.status !== 'complete') throw error;
        process.stderr.write(`Zillow read completed; browser cleanup pending: ${error.message}\n`);
        return { ...result, cleanup: { status: 'pending', browser: record.browser,
          recoveryHandle: token, error: error.message } };
      }
      store.remove(token);
      return result;
    };
    if (record.completedResult) {
      if (record.completedResult.status !== 'complete') throw new Error('Invalid stored completed result');
      return finish(cancel ? { status: 'cancelled' } : record.completedResult);
    }
    if (cancel && !record.targetId) {
      manage(['close', record.browser]); store.remove(token);
      return { status: 'cancelled' };
    }
    const result = run(script, [cancel ? 'cancel' : 'read', JSON.stringify(record)], { browser: record.browser });
    if (result.status === 'needs_human') {
      if (typeof result.targetId !== 'string' || !result.targetId) throw new Error('Missing challenge target');
      record.targetId = result.targetId;
      store.save(token, record);
      return { status: 'needs_human', resumeHandle: token, browser: record.browser, challengeUrl: result.challengeUrl,
        instruction: 'Ask the human to solve verification in the visible Zillow tab, then run websites zillow intervention resume with this handle. Do not automate solving.' };
    }
    if (!['complete', 'cancelled'].includes(result.status)) throw new Error('Unexpected intervention result');
    return finish(result);
  } finally { unlock(); }
}
