// Sanitized Buttondown API helpers for website operations.

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

const EMAIL_KEEP_KEYS = new Set([
  'id',
  'creation_date',
  'absolute_url',
  'canonical_url',
  'description',
  'archival_mode',
  'email_type',
  'featured',
  'image',
  'modification_date',
  'publish_date',
  'slug',
  'source',
  'status',
  'subject',
]);

const RESOURCE_KEEP_KEYS = {
  newsletters: NEWSLETTER_KEEP_KEYS,
  tags: TAG_KEEP_KEYS,
  subscribers: SUBSCRIBER_KEEP_KEYS,
  emails: EMAIL_KEEP_KEYS,
};

const EDITOR_MODES = new Set(['auto', 'fancy', 'plaintext']);

function appendParams(url, params) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === '') continue;
        url.searchParams.append(key, item);
      }
    } else {
      url.searchParams.set(key, value);
    }
  }
}

export async function apiRequest(
  path,
  { method = 'GET', params = {}, body, token, baseUrl, fetchImpl, headers = {} } = {},
) {
  const apiToken = token ?? process.env.BUTTONDOWN_API_KEY;
  if (!apiToken) {
    throw new Error('BUTTONDOWN_API_KEY env var is required');
  }

  const root = (baseUrl ?? process.env.BUTTONDOWN_API_BASE_URL ?? BASE_URL).replace(/\/+$/, '');
  const url = new URL(`${root}${path}`);
  appendParams(url, params);

  const requestHeaders = {
    Accept: 'application/json',
    Authorization: `Token ${apiToken}`,
    'User-Agent': 'websites-buttondown-api/1.0',
    ...headers,
  };

  const request = {
    method,
    headers: requestHeaders,
  };

  if (body !== undefined) {
    request.headers = {
      ...request.headers,
      'Content-Type': 'application/json',
    };
    request.body = JSON.stringify(body);
  }

  const response = await (fetchImpl ?? fetch)(url, request);
  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(`Buttondown API ${response.status} for ${path}: ${responseBody.slice(0, 500)}`);
  }

  if (responseBody.length === 0) return null;

  try {
    return JSON.parse(responseBody);
  } catch {
    return responseBody;
  }
}

export async function apiGet(path, params = {}, options = {}) {
  return apiRequest(path, { ...options, method: 'GET', params });
}

export async function apiPost(path, body, options = {}) {
  return apiRequest(path, { ...options, method: 'POST', body });
}

export async function apiPatch(path, body, options = {}) {
  return apiRequest(path, { ...options, method: 'PATCH', body });
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

export function sanitizeEmailPayload(payload, { includeBody = false } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const keepKeys = includeBody ? new Set([...EMAIL_KEEP_KEYS, 'body']) : EMAIL_KEEP_KEYS;
  return sanitizeObject(payload, keepKeys);
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

export function buildEmailListParams(options) {
  const params = {
    ordering: options.ordering,
    excluded_fields: ['body'],
  };

  if (options.status) params.status = [options.status];
  if (options.subject) params.subject = options.subject;
  if (options.source) params.source = [options.source];
  if (options.creationDateStart) params.creation_date__start = options.creationDateStart;
  if (options.creationDateEnd) params.creation_date__end = options.creationDateEnd;
  if (options.publishDateStart) params.publish_date__start = options.publishDateStart;
  if (options.publishDateEnd) params.publish_date__end = options.publishDateEnd;

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

function compactObject(entries) {
  const output = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null && value !== '') output[key] = value;
  }
  return output;
}

function compactSubscriberFilters(options, resolvedTagId) {
  return compactObject({
    type: options.type,
    tag: options.tag,
    tag_id: resolvedTagId,
    date_start: options.dateStart,
    date_end: options.dateEnd,
    source: options.source,
    referrer_url: options.referrerUrl,
    ordering: options.ordering,
    limit: options.limit,
  });
}

function compactEmailFilters(options) {
  return compactObject({
    status: options.status,
    subject: options.subject,
    source: options.source,
    creation_date_start: options.creationDateStart,
    creation_date_end: options.creationDateEnd,
    publish_date_start: options.publishDateStart,
    publish_date_end: options.publishDateEnd,
    ordering: options.ordering,
  });
}

export function bodyLooksLikeFrontmatter(body) {
  return /^---\s*\r?\n/.test(body);
}

export function withEditorMode(body, editorMode = 'plaintext') {
  if (!EDITOR_MODES.has(editorMode)) {
    throw new Error(`Unsupported editor mode: ${editorMode}`);
  }
  if (editorMode === 'auto') return body;
  if (/^<!--\s*buttondown-editor-mode:/i.test(body)) return body;
  return `<!-- buttondown-editor-mode: ${editorMode} -->\n${body}`;
}

export function buildEmailCreatePayload(options) {
  const subject = options.subject?.trim();
  if (!subject) throw new Error('Email subject is required');

  const rawBody = options.body ?? '';
  if (bodyLooksLikeFrontmatter(rawBody)) {
    throw new Error('Email body appears to start with YAML frontmatter; strip frontmatter before creating a Buttondown draft');
  }

  const payload = {
    subject,
    body: withEditorMode(rawBody, options.editorMode ?? 'plaintext'),
    status: 'draft',
  };

  if (options.description) payload.description = options.description;
  if (options.canonicalUrl) payload.canonical_url = options.canonicalUrl;
  if (options.slug) payload.slug = options.slug;
  if (options.image) payload.image = options.image;

  return payload;
}

export function buildEmailUpdatePayload(options) {
  const payload = {};

  if (options.subject !== undefined) {
    const subject = options.subject.trim();
    if (!subject) throw new Error('Email subject cannot be empty');
    payload.subject = subject;
  }

  if (options.body !== undefined) {
    if (bodyLooksLikeFrontmatter(options.body)) {
      throw new Error('Email body appears to start with YAML frontmatter; strip frontmatter before updating a Buttondown draft');
    }
    payload.body = withEditorMode(options.body, options.editorMode ?? 'plaintext');
  }

  if (options.description !== undefined) payload.description = options.description;
  if (options.canonicalUrl !== undefined) payload.canonical_url = options.canonicalUrl;
  if (options.slug !== undefined) payload.slug = options.slug;
  if (options.image !== undefined) payload.image = options.image;

  if (Object.keys(payload).length === 0) {
    throw new Error('At least one email field is required for update');
  }

  return payload;
}

export async function createEmailDraft(options, { post = apiPost } = {}) {
  const payload = buildEmailCreatePayload(options);
  const email = await post('/emails', payload);
  return sanitizeEmailPayload(email);
}

export async function updateEmail(id, options, { patch = apiPatch } = {}) {
  if (!id) throw new Error('Email ID is required');
  const payload = buildEmailUpdatePayload(options);
  const email = await patch(`/emails/${encodeURIComponent(id)}`, payload);
  return sanitizeEmailPayload(email);
}

export async function retrieveEmail(id, { includeBody = false, get = apiGet } = {}) {
  if (!id) throw new Error('Email ID is required');
  const email = await get(`/emails/${encodeURIComponent(id)}`);
  return sanitizeEmailPayload(email, { includeBody });
}

export async function sendDraftEmail(id, recipients, { post = apiPost } = {}) {
  if (!id) throw new Error('Email ID is required');
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('At least one draft recipient is required');
  }

  await post(`/emails/${encodeURIComponent(id)}/send-draft`, { recipients });
  return {
    action: 'send-draft',
    id,
    recipient_count: recipients.length,
  };
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
        filters: compactSubscriberFilters(options, resolvedTagId),
      };
    }
    case 'emails': {
      const params = buildEmailListParams(options);
      const payload = await get('/emails', params);
      return {
        ...sanitizeListPayload(resource, payload),
        filters: compactEmailFilters(options),
      };
    }
    default:
      throw new Error(`Unsupported resource: ${resource}`);
  }
}
