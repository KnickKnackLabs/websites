#!/usr/bin/env node
// Sanitized read-only Buttondown API helpers for KKL website operations.

import { pathToFileURL } from 'node:url';

const BASE_URL = 'https://api.buttondown.com/v1';

const SENSITIVE_KEYS = new Set([
  'api_key',
  'email',
  'email_address',
  'email_domain',
  'from_email',
  'reply_to_address',
]);

const NEWSLETTER_KEEP_KEYS = new Set([
  'id',
  'name',
  'username',
  'description',
  'subscription_redirect_url',
  'subscription_confirmation_redirect_url',
  'enabled_features',
  'test_mode',
]);

const TAG_KEEP_KEYS = new Set([
  'id',
  'name',
  'creation_date',
  'description',
  'public_description',
  'subscriber_editable',
]);

const SUBSCRIBER_KEEP_KEYS = new Set([
  'creation_date',
  'subscriber_type',
  'type',
  'status',
  'tags',
  'source',
  'referrer_url',
  'unsubscription_date',
  'churn_date',
  'undeliverability_date',
  'undeliverability_reason',
]);

const RESOURCE_KEEP_KEYS = {
  newsletters: NEWSLETTER_KEEP_KEYS,
  tags: TAG_KEEP_KEYS,
  subscribers: SUBSCRIBER_KEEP_KEYS,
};

const VALID_RESOURCES = new Set(Object.keys(RESOURCE_KEEP_KEYS));

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseArgs(argv) {
  const [resource, ...args] = argv;
  if (!VALID_RESOURCES.has(resource)) {
    throw new Error(`Usage: buttondown api <${[...VALID_RESOURCES].join('|')}> [filters]`);
  }

  const options = {
    limit: '10',
    ordering: '-creation_date',
    pageSize: '1000',
  };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    switch (flag) {
      case '--limit':
        options.limit = readValue(args, index, flag);
        index += 1;
        break;
      case '--ordering':
        options.ordering = readValue(args, index, flag);
        index += 1;
        break;
      case '--page-size':
        options.pageSize = readValue(args, index, flag);
        index += 1;
        break;
      case '--type':
        options.type = readValue(args, index, flag);
        index += 1;
        break;
      case '--tag':
        options.tag = readValue(args, index, flag);
        index += 1;
        break;
      case '--date-start':
        options.dateStart = readValue(args, index, flag);
        index += 1;
        break;
      case '--date-end':
        options.dateEnd = readValue(args, index, flag);
        index += 1;
        break;
      case '--source':
        options.source = readValue(args, index, flag);
        index += 1;
        break;
      case '--referrer-url':
        options.referrerUrl = readValue(args, index, flag);
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  return { resource, options };
}

function appendParams(url, params) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
    } else {
      url.searchParams.set(key, value);
    }
  }
}

export async function apiGet(path, params = {}, { token, baseUrl, fetchImpl } = {}) {
  const apiToken = token ?? process.env.BUTTONDOWN_API_KEY;
  if (!apiToken) {
    throw new Error('BUTTONDOWN_API_KEY env var is required');
  }

  const root = (baseUrl ?? process.env.BUTTONDOWN_API_BASE_URL ?? BASE_URL).replace(/\/+$/, '');
  const url = new URL(`${root}${path}`);
  appendParams(url, params);

  const response = await (fetchImpl ?? fetch)(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Token ${apiToken}`,
      'User-Agent': 'websites-buttondown-api/1.0',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Buttondown API ${response.status} for ${path}: ${body.slice(0, 500)}`);
  }

  return response.json();
}

export function listItems(payload) {
  if (Array.isArray(payload)) return payload.filter(item => item && typeof item === 'object');
  if (!payload || typeof payload !== 'object') return [];

  for (const key of ['results', 'data', 'items']) {
    if (Array.isArray(payload[key])) {
      return payload[key].filter(item => item && typeof item === 'object');
    }
  }

  return [];
}

export function sanitizeObject(object, keepKeys) {
  const sanitized = {};
  for (const [key, value] of Object.entries(object)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    if (keepKeys.has(key)) sanitized[key] = value;
  }
  return sanitized;
}

export function sanitizeListPayload(resource, payload) {
  const keepKeys = RESOURCE_KEEP_KEYS[resource];
  const results = listItems(payload).map(item => sanitizeObject(item, keepKeys));
  const output = {
    resource,
    count: typeof payload?.count === 'number' ? payload.count : results.length,
    results,
  };

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    if ('next' in payload) output.has_next_page = Boolean(payload.next);
    if ('previous' in payload) output.has_previous_page = Boolean(payload.previous);
  }

  return output;
}

export function buildSubscriberParams(options, resolvedTagId) {
  const params = {
    ordering: options.ordering,
    limit: options.limit,
  };

  if (options.type) params.type = options.type;
  if (resolvedTagId) params.tag = resolvedTagId;
  if (options.dateStart) params.date__start = options.dateStart;
  if (options.dateEnd) params.date__end = options.dateEnd;
  if (options.source) params.source = options.source;
  if (options.referrerUrl) params.referrer_url = options.referrerUrl;

  return params;
}

export function tagIdFromTagsPayload(payload, tagName) {
  const tag = listItems(payload).find(item => item.name === tagName);
  return tag?.id ? String(tag.id) : null;
}

export async function resolveTagId(tag, { get = apiGet } = {}) {
  if (!tag) return null;
  if (tag.startsWith('sub_tag_')) return tag;

  const tagsPayload = await get('/tags', { page_size: '1000' });
  const tagId = tagIdFromTagsPayload(tagsPayload, tag);
  if (!tagId) {
    throw new Error(`Buttondown tag not found: ${tag}`);
  }
  return tagId;
}

function compactFilters(options, resolvedTagId) {
  const filters = {};
  for (const [key, value] of Object.entries({
    type: options.type,
    tag: options.tag,
    tag_id: resolvedTagId,
    date_start: options.dateStart,
    date_end: options.dateEnd,
    source: options.source,
    referrer_url: options.referrerUrl,
    ordering: options.ordering,
    limit: options.limit,
  })) {
    if (value !== undefined && value !== null && value !== '') filters[key] = value;
  }
  return filters;
}

export async function runResource(resource, options, { get = apiGet } = {}) {
  switch (resource) {
    case 'newsletters': {
      const payload = await get('/newsletters');
      return sanitizeListPayload(resource, payload);
    }
    case 'tags': {
      const payload = await get('/tags', { page_size: options.pageSize });
      return sanitizeListPayload(resource, payload);
    }
    case 'subscribers': {
      const resolvedTagId = await resolveTagId(options.tag, { get });
      const params = buildSubscriberParams(options, resolvedTagId);
      const payload = await get('/subscribers', params);
      return {
        ...sanitizeListPayload(resource, payload),
        filters: compactFilters(options, resolvedTagId),
      };
    }
    default:
      throw new Error(`Unsupported resource: ${resource}`);
  }
}

async function main() {
  const { resource, options } = parseArgs(process.argv.slice(2));
  const output = await runResource(resource, options);
  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}
