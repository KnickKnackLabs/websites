// Shared helpers for Buttondown mise task entrypoints.

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export function optionalUsageEnv(name) {
  const value = process.env[`usage_${name}`];
  return value && value.length > 0 ? value : undefined;
}

export function usageFlag(name) {
  const value = process.env[`usage_${name}`];
  return value === 'true' || value === '1';
}

export function callerPath(path) {
  if (!path || path === '-' || isAbsolute(path)) return path;
  return resolve(process.env.WEBSITES_CALLER_PWD ?? process.cwd(), path);
}

export function readTextPayload(path) {
  if (!path) throw new Error('Payload file path is required');
  if (path === '-') return readFileSync(0, 'utf8');
  return readFileSync(callerPath(path), 'utf8');
}

export function splitRecipients(value, fileValue) {
  const recipients = [];
  const add = text => {
    if (!text) return;
    for (const item of text.split(/[\n,]/)) {
      const recipient = item.trim();
      if (recipient) recipients.push(recipient);
    }
  };

  add(value);
  if (fileValue) add(readTextPayload(fileValue));

  return [...new Set(recipients)];
}

export async function printJsonTask(callback) {
  try {
    const output = await callback();
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    printTaskError(error);
  }
}

export async function printTask(callback, { json = false, human = defaultHumanOutput } = {}) {
  try {
    const output = await callback();
    if (json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(human(output));
    }
  } catch (error) {
    printTaskError(error);
  }
}

function printTaskError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function defaultHumanOutput(output) {
  if (output && typeof output === 'object' && Array.isArray(output.results)) {
    return formatResourceList(output);
  }
  return JSON.stringify(output, null, 2);
}

export function formatResourceList(output) {
  const count = output.count ?? output.results.length;
  const lines = [`Buttondown ${output.resource}: ${count} total; ${output.results.length} shown`];

  if (output.filters && Object.keys(output.filters).length > 0) {
    const filters = Object.entries(output.filters).map(([key, value]) => `${key}=${value}`).join(', ');
    lines.push(`filters: ${filters}`);
  }

  if (output.results.length === 0) {
    lines.push('No results.');
    return lines.join('\n');
  }

  for (const item of output.results) {
    lines.push(`- ${formatResourceItem(output.resource, item)}`);
  }

  return lines.join('\n');
}

function formatResourceItem(resource, item) {
  switch (resource) {
    case 'emails':
      return [item.status, item.subject, item.id, item.absolute_url]
        .filter(Boolean)
        .join(' · ');
    case 'subscribers':
      return [item.type ?? item.subscriber_type ?? item.status, item.source, item.referrer_url, item.creation_date]
        .filter(Boolean)
        .join(' · ');
    case 'tags':
      return [item.name, item.id, item.subscriber_editable === true ? 'subscriber-editable' : undefined]
        .filter(Boolean)
        .join(' · ');
    case 'newsletters':
      return [item.name, item.username, item.test_mode === true ? 'test-mode' : undefined]
        .filter(Boolean)
        .join(' · ');
    default:
      return JSON.stringify(item);
  }
}
