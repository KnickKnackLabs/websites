import { spawnSync } from 'node:child_process';

export const RESULT_PREFIX = 'WEBSITES_ZILLOW_RESULT=';

export function parseBrowserResult(stdout) {
  const lines = stdout.split(/\r?\n/).filter(line => line.startsWith(RESULT_PREFIX));
  if (lines.length !== 1) throw new Error(`Expected one Zillow result, received ${lines.length}`);
  return JSON.parse(lines[0].slice(RESULT_PREFIX.length));
}

// Browser's CLI emits a preamble on stdout. Never mix that into our JSON output.
export function runBrowser(script, args, { browser, headed = false, spawn = spawnSync } = {}) {
  const flags = browser ? ['--browser', browser] : [];
  if (headed) flags.push('--headed');
  const result = spawn('browser', ['run', ...flags, script, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.stderr) process.stderr.write(result.stderr);
  const diagnostics = (result.stdout ?? '').split(/\r?\n/).filter(line => !line.startsWith(RESULT_PREFIX) && line.length).join('\n');
  if (diagnostics) process.stderr.write(`${diagnostics}\n`);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`browser run failed (${result.signal ?? result.status})`);
  return parseBrowserResult(result.stdout ?? '');
}
