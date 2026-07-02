// token-rotate.mjs — Regenerate a classic GitHub PAT
//
// Assumes GITHUB_USERNAME and GITHUB_PASSWORD env vars are set.
// Logs in, navigates to the classic tokens page, regenerates a named token,
// and outputs TOKEN:<value> on the last line for the calling task to capture.
//
// Usage: browser run --headed ./scripts/github/token-rotate.mjs -- <token-name> [login-id]

import { login, resolveGitHubTotpCode } from './login.mjs';
import { openGitHubSensitivePage } from './sensitive-page-gate.mjs';
import { record } from '../record.mjs';
import { logSafePageFacts } from './page-diagnostics.mjs';
import { TOKEN_DISPLAY_SELECTOR, waitForGitHubToken } from './token-capture.mjs';
import {
  findClassicTokenByName,
  isGitHubToken,
  listClassicTokens,
  parseTokenFromText,
  parseTokenId,
} from './tokens.mjs';

// Re-export pure functions for compatibility with existing tests/importers.
export { parseTokenFromText, parseTokenId };

// --- Script entry point ---

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

  // --- Login ---
  const loginResult = await login(page, { agent: loginId, username, password });
  const sensitivePageOptions = {
    agent: loginId,
    loginTotpCode: loginResult.loginTotpCode,
    totpResolver: resolveGitHubTotpCode,
  };

  // --- Navigate to classic tokens page ---
  await openGitHubSensitivePage(page, 'https://github.com/settings/tokens', sensitivePageOptions);
  record(`tokens-page-${loginId}.html`, await page.content());

  const loginFormStillVisible = await page.locator('input[name="login"], input[name="password"]').first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
  if (loginFormStillVisible) {
    console.error(`Not authenticated after login; redirected to ${page.url()}`);
    await logSafePageFacts(page, 'Safe page facts after failed authentication');
    process.exit(1);
  }

  // --- Find the token by exact visible name ---
  const tokens = await listClassicTokens(page);
  const token = findClassicTokenByName(tokens, tokenName);
  if (!token) {
    console.error(`Token named "${tokenName}" not found.`);
    console.error(`Found ${tokens.length} token(s) on page:`);
    for (const visibleToken of tokens) {
      console.error(`  - ${visibleToken.id}\t${visibleToken.name}`);
    }
    await logSafePageFacts(page, 'Safe page facts for missing token');
    process.exit(1);
  }

  const tokenId = token.id;
  if (!tokenId) {
    console.error(`Could not extract token ID for token: ${tokenName}`);
    process.exit(1);
  }

  console.log(`Found token "${tokenName}" (ID: ${tokenId}). Regenerating...`);

  // --- Regenerate ---
  await openGitHubSensitivePage(page, `https://github.com/settings/tokens/${tokenId}/regenerate`, sensitivePageOptions);
  record(`regenerate-page-${loginId}.html`, await page.content());

  // Set expiration to 30 days
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

  // Click "Regenerate token"
  const regenerateBtn = page.locator('button:has-text("Regenerate token"), input[value*="Regenerate"]').first();
  try {
    await regenerateBtn.waitFor({ state: 'visible', timeout: 5000 });
  } catch (error) {
    console.error('Could not find visible Regenerate token button.');
    await logSafePageFacts(page, 'Safe page facts for missing regenerate button');
    throw error;
  }
  await regenerateBtn.click();

  // Wait for the new token to appear (wait for the token display element instead of a fixed sleep)
  await page.waitForLoadState('domcontentloaded');
  const tokenDisplayLocator = page.locator(TOKEN_DISPLAY_SELECTOR).first();
  await tokenDisplayLocator.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
    console.error('Warning: token display element not found within timeout, will try fallback methods.');
  });
  record(`regenerated-page-${loginId}.html`, await page.content());

  // --- Capture the new token ---
  const newToken = await waitForGitHubToken(page, { timeoutMs: 3000 });

  if (!isGitHubToken(newToken)) {
    console.error('Could not capture new token from page.');
    console.error('The token may have been regenerated — check the browser window.');
    await logSafePageFacts(page, 'Safe page facts after token capture failure');
    process.exit(1);
  }

  console.log('Token regenerated successfully.');
  console.log(`TOKEN:${newToken}`);
}
