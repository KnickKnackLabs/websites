import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_DIRECTORY = join(homedir(), '.local', 'state', 'websites', 'zillow');
const OPERATIONS = ['search', 'listing', 'property'];

// Handles are private capabilities, never caller-supplied filesystem paths.
export class HandoffStore {
  constructor(directory = DEFAULT_DIRECTORY) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  path(token) {
    if (!/^[a-f0-9]{48}$/.test(token)) {
      throw new Error('Invalid Zillow resume handle');
    }
    return join(this.directory, `${token}.json`);
  }

  save(token, record) {
    const destination = this.path(token);
    const temporary = `${destination}.${randomBytes(8).toString('hex')}`;
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, destination);
  }

  load(token) {
    const record = JSON.parse(readFileSync(this.path(token), 'utf8'));
    const validBrowser = /^b-[a-f0-9-]+$/.test(record.browser);
    const validOperation = OPERATIONS.includes(record.operation);
    if (record.version !== 1 || !validBrowser || !validOperation) {
      throw new Error('Invalid stored Zillow handoff');
    }
    return record;
  }

  remove(token) {
    unlinkSync(this.path(token));
  }

  lock(token) {
    const lockDirectory = `${this.path(token)}.lock`;
    mkdirSync(lockDirectory, { mode: 0o700 });
    return () => rmdirSync(lockDirectory);
  }
}
