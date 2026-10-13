import { spawnSync } from 'node:child_process';

export const RESULT_PREFIX = 'WEBSITES_ZILLOW_RESULT=';
const MAX_RESULT_BYTES = 32 * 1024 * 1024;
const MANAGED_COMMAND_TIMEOUT_MS = 45000;

export function parseBrowserResult(stdout) {
  const frames = stdout.split(/\r?\n/).filter(line => line.startsWith(RESULT_PREFIX));
  if (frames.length !== 1) {
    throw new Error(`Expected one Zillow result, received ${frames.length}`);
  }
  return JSON.parse(frames[0].slice(RESULT_PREFIX.length));
}

function writeDiagnostics(result) {
  if (result.stderr) process.stderr.write(result.stderr);

  // Browser emits a preamble on stdout; only our result frame belongs in JSON.
  const lines = (result.stdout ?? '').split(/\r?\n/);
  const diagnostics = lines.filter(line => line.length && !line.startsWith(RESULT_PREFIX));
  if (diagnostics.length) process.stderr.write(`${diagnostics.join('\n')}\n`);
}

export function runBrowser(script, args, {
  browser,
  headed = false,
  spawn = spawnSync,
} = {}) {
  const command = ['run'];
  if (browser) command.push('--browser', browser);
  if (headed) command.push('--headed');
  command.push(script, ...args);

  const result = spawn('browser', command, {
    encoding: 'utf8',
    maxBuffer: MAX_RESULT_BYTES,
  });
  writeDiagnostics(result);

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`browser run failed (${result.signal ?? result.status})`);
  }
  return parseBrowserResult(result.stdout ?? '');
}

export function managedBrowser(command, spawn = spawnSync) {
  // Detached workers inherit stderr. Capturing that pipe can keep launch open
  // after its command exits, so inherit it instead of waiting for pipe EOF.
  const result = spawn('browser', command, {
    encoding: 'utf8',
    timeout: MANAGED_COMMAND_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`browser ${command[0]} failed (${result.status}); recovery may require browser close`);
  }
  return result.stdout.trim();
}
