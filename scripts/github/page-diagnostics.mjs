// page-diagnostics.mjs — Structure-first safe diagnostics for GitHub automation pages.

const GITHUB_TOKEN_RE = /(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const RECOVERY_CODE_RE = /\b[a-z0-9]{5}-[a-z0-9]{5}\b/gi;
const CONTEXTUAL_CODE_RE = /\b(?:otp|totp|verification|authentication|code)\D{0,24}(\d{6,8})\b/gi;

function compact(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function redactSensitiveText(text) {
  return compact(text)
    .replace(GITHUB_TOKEN_RE, '[REDACTED_GITHUB_TOKEN]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(RECOVERY_CODE_RE, '[REDACTED_RECOVERY_CODE]')
    .replace(CONTEXTUAL_CODE_RE, (match, code) => match.replace(code, '[REDACTED_CODE]'));
}

export function safeUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    parsed.username = '';
    parsed.password = '';
    if (parsed.search) parsed.search = '?[query]';
    if (parsed.hash) parsed.hash = '#[fragment]';
    return redactSensitiveText(parsed.toString());
  } catch {
    return redactSensitiveText(url);
  }
}

function limitedStrings(values, limit = 30) {
  return (values || [])
    .map(redactSensitiveText)
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeControl(control) {
  const tag = redactSensitiveText(control?.tag || '').toLowerCase();
  const type = redactSensitiveText(control?.type || '').toLowerCase();
  const valuePresent = Boolean(control?.valuePresent || control?.value);
  const normalized = {
    tag,
    type,
    id: redactSensitiveText(control?.id || ''),
    name: redactSensitiveText(control?.name || ''),
    labels: limitedStrings(control?.labels || [], 4),
    disabled: Boolean(control?.disabled),
  };

  if (valuePresent) normalized.value = '[present]';
  if ((tag === 'button' || ['button', 'submit', 'reset'].includes(type)) && control?.text) {
    normalized.text = redactSensitiveText(control.text).slice(0, 160);
  }
  return normalized;
}

export function sanitizePageFacts(rawFacts = {}) {
  return {
    url: safeUrl(rawFacts.url || ''),
    title: redactSensitiveText(rawFacts.title || ''),
    headings: limitedStrings(rawFacts.headings || [], 30),
    alerts: limitedStrings(rawFacts.alerts || [], 30),
    buttons: limitedStrings(rawFacts.buttons || [], 80),
    controls: (rawFacts.controls || []).slice(0, 80).map(normalizeControl),
  };
}

async function visibleTexts(page, selector, limit = 30) {
  try {
    return await page.locator(selector).evaluateAll((elements, max) => elements
      .filter((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      })
      .map((el) => el.innerText || el.textContent || '')
      .filter(Boolean)
      .slice(0, max), limit);
  } catch {
    try {
      return (await page.locator(selector).allTextContents()).slice(0, limit);
    } catch {
      return [];
    }
  }
}

export async function sanitizedPageFacts(page) {
  const [title, headings, alerts, buttons, controls] = await Promise.all([
    page.title().catch(() => ''),
    visibleTexts(page, 'h1,h2,h3', 30),
    visibleTexts(page, '[role="alert"], .flash, .flash-error, .flash-warn, .flash-notice', 30),
    visibleTexts(page, 'button, input[type="button"], input[type="submit"], a.btn', 80),
    page.evaluate(() => Array.from(document.querySelectorAll('input, button, select, textarea'))
      .filter((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      })
      .slice(0, 80)
      .map((el) => {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const labels = Array.from(el.labels || []).map(label => label.innerText || label.textContent || '');
        const value = el.getAttribute('value') || el.value || '';
        return {
          tag,
          type,
          id: el.id || '',
          name: el.getAttribute('name') || '',
          labels,
          valuePresent: Boolean(value),
          text: tag === 'button' || ['button', 'submit', 'reset'].includes(type)
            ? (el.innerText || el.textContent || value || '')
            : '',
          disabled: Boolean(el.disabled),
        };
      })).catch(() => []),
  ]);

  return sanitizePageFacts({
    url: page.url(),
    title,
    headings,
    alerts,
    buttons,
    controls,
  });
}

export function formatPageFacts(facts) {
  return JSON.stringify(sanitizePageFacts(facts), null, 2);
}

export async function logSafePageFacts(page, label = 'Safe page facts') {
  console.error(`${label}:`);
  console.error(formatPageFacts(await sanitizedPageFacts(page)));
}
