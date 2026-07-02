// token-create.mjs — Create a new classic GitHub PAT
//
// Assumes GITHUB_USERNAME and GITHUB_PASSWORD env vars are set.
// Logs in, navigates to the classic token creation page, creates a named token,
// and outputs TOKEN:<value> on the last line for the calling task to capture.
//
// Usage: browser run --headed ./scripts/github/token-create.mjs -- <token-name> [login-id]

import { login, resolveGitHubTotpCode } from './login.mjs';
import { openGitHubSensitivePage } from './sensitive-page-gate.mjs';
import { record } from '../record.mjs';
import { captureGitHubTokenFromPage, TOKEN_DISPLAY_SELECTOR, waitForGitHubToken } from './token-capture.mjs';
import { logSafePageFacts } from './page-diagnostics.mjs';
import { isGitHubToken } from './tokens.mjs';

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

const captureToken = captureGitHubTokenFromPage;

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

  const loginResult = await login(page, { agent: loginId, username, password });

  await openGitHubSensitivePage(page, tokenCreationUrl(tokenName), {
    agent: loginId,
    loginTotpCode: loginResult.loginTotpCode,
    totpResolver: resolveGitHubTotpCode,
  });
  record(`token-create-page-${loginId}.html`, await page.content());

  const loginFormStillVisible = await page.locator('input[name="login"], input[name="password"]').first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
  if (loginFormStillVisible) {
    console.error(`Not authenticated after login; redirected to ${page.url()}`);
    await logSafePageFacts(page, 'Safe page facts after failed authentication');
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
  try {
    await createButton.waitFor({ state: 'visible', timeout: 5000 });
  } catch (error) {
    console.error('Could not find visible Generate token button.');
    await logSafePageFacts(page, 'Safe page facts for missing create button');
    throw error;
  }
  await createButton.click();

  await page.waitForLoadState('domcontentloaded');
  const tokenDisplayLocator = page.locator(TOKEN_DISPLAY_SELECTOR).first();
  await tokenDisplayLocator.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
    console.error('Warning: token display element not found within timeout, will try fallback methods.');
  });
  record(`token-created-page-${loginId}.html`, await page.content());

  const newToken = await waitForGitHubToken(page, { timeoutMs: 3000 });
  if (!isGitHubToken(newToken)) {
    console.error('Could not capture new token from page.');
    console.error('The token may have been created — check the browser window.');
    await logSafePageFacts(page, 'Safe page facts after token capture failure');
    process.exit(1);
  }

  console.log('Token created successfully.');
  console.log(`TOKEN:${newToken}`);
}
