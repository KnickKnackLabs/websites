// token-list.mjs — List visible classic GitHub PATs
//
// Assumes GITHUB_USERNAME and GITHUB_PASSWORD env vars are set.
// Logs in, navigates to the classic tokens page, and emits machine-readable
// token metadata. Does not print token secret values.
//
// Usage: browser run ./scripts/github/token-list.mjs -- <login-id>

import { login } from './login.mjs';
import { record } from '../record.mjs';
import { listClassicTokens } from './tokens.mjs';

export default async function({ page, args }) {
  const loginId = args[0] || process.env.WEBSITES_LOGIN_ID || 'github';

  const username = process.env.GITHUB_USERNAME;
  const password = process.env.GITHUB_PASSWORD;
  if (!username || !password) {
    console.error('GITHUB_USERNAME and GITHUB_PASSWORD env vars required');
    process.exit(1);
  }

  await login(page, { agent: loginId, username, password });

  await page.goto('https://github.com/settings/tokens');
  await page.waitForLoadState('domcontentloaded');
  record(`tokens-page-${loginId}.html`, await page.content());

  const loginFormStillVisible = await page.locator('input[name="login"], input[name="password"]').first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
  if (loginFormStillVisible) {
    console.error(`Not authenticated after login; redirected to ${page.url()}`);
    process.exit(1);
  }

  const tokens = await listClassicTokens(page);
  console.log(`TOKENS_JSON:${JSON.stringify(tokens)}`);
}
