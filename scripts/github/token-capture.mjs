// token-capture.mjs — Shared GitHub PAT capture after create/regenerate pages.

import { GITHUB_TOKEN_PATTERN, isGitHubToken, parseTokenFromText } from './tokens.mjs';

export const TOKEN_DISPLAY_SELECTOR = [
  'input#new-oauth-token',
  '[data-clipboard-text^="ghp_"]',
  '[data-clipboard-text^="gho_"]',
  '[data-clipboard-text^="ghu_"]',
  '[data-clipboard-text^="ghs_"]',
  '[data-clipboard-text^="ghr_"]',
  '[data-clipboard-text^="github_pat_"]',
].join(', ');

const TOKEN_CAPTURE_SELECTORS = [
  'input#new-oauth-token',
  '[data-clipboard-text]',
  'clipboard-copy',
  'input[value*="ghp_"], input[value*="gho_"], input[value*="ghu_"], input[value*="ghs_"], input[value*="ghr_"], input[value*="github_pat_"]',
  'textarea',
  'code',
  'pre',
  '.token',
  '.oauth-token',
];

async function tokenFromElement(element) {
  const candidates = [];
  for (const attr of ['value', 'data-clipboard-text', 'aria-label', 'title']) {
    candidates.push(await element.getAttribute(attr).catch(() => null));
  }
  candidates.push(await element.textContent().catch(() => null));

  for (const candidate of candidates) {
    const token = parseTokenFromText(candidate || '');
    if (isGitHubToken(token)) return token;
  }
  return null;
}

export async function captureGitHubTokenFromPage(page) {
  for (const selector of TOKEN_CAPTURE_SELECTORS) {
    const loc = page.locator(selector);
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const token = await tokenFromElement(loc.nth(i));
      if (token) return token;
    }
  }

  // Last resort: inspect DOM text and attributes in the browser context, but
  // return only the token value. Never return/log the matching candidate or HTML.
  const token = await page.evaluate((patternSource) => {
    const re = new RegExp(patternSource);
    const candidates = [document.body?.innerText || '', document.documentElement?.outerHTML || ''];
    for (const el of document.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) candidates.push(el.getAttribute(attr) || '');
    }
    for (const candidate of candidates) {
      const match = String(candidate || '').match(re);
      if (match) return match[1];
    }
    return null;
  }, GITHUB_TOKEN_PATTERN.source).catch(() => null);

  return isGitHubToken(token) ? token : null;
}

export async function waitForGitHubToken(page, { timeoutMs = 15000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    const token = await captureGitHubTokenFromPage(page);
    if (token) return token;
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(intervalMs).catch(() => new Promise(resolve => setTimeout(resolve, intervalMs)));
    } else {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  } while (Date.now() < deadline);

  return captureGitHubTokenFromPage(page);
}
