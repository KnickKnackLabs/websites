// record.mjs — Record intermediate data during live runs for golden file tests
//
// Set WEBSITES_RECORD_DIR to enable recording. Scripts call record() with a
// filename and data, which gets written to that directory for later use as
// test fixtures.
//
// Usage:
//   import { record } from './record.mjs';
//   await record('token-page.html', await page.content());
//   await record('email-list.txt', listOutput);

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const recordDir = process.env.WEBSITES_RECORD_DIR || '';

export function isRecording() {
  return !!recordDir;
}

export function record(filename, data) {
  if (!recordDir) return;
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(join(recordDir, filename), data, 'utf-8');
  console.log(`[record] ${filename}`);
}
