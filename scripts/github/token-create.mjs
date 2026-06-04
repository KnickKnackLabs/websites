// token-create.mjs — Create a new classic GitHub PAT
//
// Assumes GITHUB_USERNAME and GITHUB_PASSWORD env vars are set.
// Logs in, navigates to the classic token creation page, creates a named token,
// and outputs TOKEN:<value> on the last line for the calling task to capture.
//
// Usage: browser run --headed ./scripts/github/token-create.mjs -- <token-name> [login-id]

import { login } from './login.mjs';
import { record } from '../record.mjs';
import { isGitHubToken, parseTokenFromText } from './tokens.mjs';

const FULL_ACCESS_SCOPES = [
  'repo',
  'workflow',
  'admin:org',
  'admin:public_key',
  'admin:gpg_key',
  'admin:ssh_signing_key',
  'admin:repo_hook',
  'admin:org_hook',
  'gist',
  'notifications',
  'user',
  'delete_repo',
  'write:packages',
  'delete:packages',
  'write:discussion',
  'project',
  'codespace',
];

function tokenCreationUrl(tokenName) {
  const params = new URLSearchParams({
    description: tokenName,
    scopes: FULL_ACCESS_SCOPES.join(','),
  });
  return `https://github.com/settings/tokens/new?${params}`;
}

async function fillIfVisible(locator, value) {
  if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
    await locator.fill(value);
    return true;
  }
  return false;
}

async function captureToken(page) {
  const tokenInput = page.locator('input#new-oauth-token');
  if (await tokenInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    const value = await tokenInput.getAttribute('value');
    if (value) return value;
  }

  const clipboardEl = page.locator('[data-clipboard-text^="ghp_"], [data-clipboard-text^="github_pat_"]').first();
  if (await clipboardEl.isVisible({ timeout: 3000 }).catch(() => false)) {
    const value = await clipboardEl.getAttribute('data-clipboard-text');
    if (value) return value;
  }

  const pageText = await page.textContent('body');
  return parseTokenFromText(pageText || '');
}

export { FULL_ACCESS_SCOPES, tokenCreationUrl, captureToken };

export default async function({ page, args }) {
  const tokenName = args[0];
  const loginId = args[1] || process.env.WEBSITES_LOGIN_ID || tokenName;
  if (!tokenName) {
    console.error('Usage: pass token name as first argument');
    process.exit(1);
  }

  const username = process.env.GITHUB_USERNAME;
  const password = process.env.GITHUB_PASSWORD;
  if (!username || !password) {
    console.error('GITHUB_USERNAME and GITHUB_PASSWORD env vars required');
    process.exit(1);
  }

  await login(page, { agent: loginId, username, password });

  await page.goto(tokenCreationUrl(tokenName));
  await page.waitForLoadState('domcontentloaded');
  record(`token-create-page-${loginId}.html`, await page.content());

  const loginFormStillVisible = await page.locator('input[name="login"], input[name="password"]').first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
  if (loginFormStillVisible) {
    console.error(`Not authenticated after login; redirected to ${page.url()}`);
    process.exit(1);
  }

  const descriptionFilled = await fillIfVisible(page.locator('input#oauth_access_description'), tokenName)
    || await fillIfVisible(page.locator('input[name="oauth_access[description]"]'), tokenName)
    || await fillIfVisible(page.locator('input[name="description"]'), tokenName);
  if (descriptionFilled) {
    console.log(`Set token description to ${tokenName}.`);
  }

  const expirationSelect = page.locator('select#token_expiration, select[name*="expiration"]').first();
  if (await expirationSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    try {
      await expirationSelect.selectOption({ label: '30 days' });
    } catch {
      const options = await expirationSelect.locator('option').allTextContents();
      const match = options.find(o => o.includes('30'));
      if (match) await expirationSelect.selectOption({ label: match });
    }
    console.log('Set expiration to 30 days.');
  }

  const createButton = page.locator('button:has-text("Generate token"), input[value*="Generate token"]').first();
  await createButton.waitFor({ state: 'visible', timeout: 5000 });
  await createButton.click();

  await page.waitForLoadState('domcontentloaded');
  const tokenDisplayLocator = page.locator('input#new-oauth-token, [data-clipboard-text^="ghp_"], [data-clipboard-text^="github_pat_"]').first();
  await tokenDisplayLocator.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
    console.error('Warning: token display element not found within timeout, will try fallback methods.');
  });
  record(`token-created-page-${loginId}.html`, await page.content());

  const newToken = await captureToken(page);
  if (!isGitHubToken(newToken)) {
    console.error('Could not capture new token from page.');
    console.error('The token may have been created — check the browser window.');
    process.exit(1);
  }

  console.log('Token created successfully.');
  console.log(`TOKEN:${newToken}`);
}
