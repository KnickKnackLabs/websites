// token-rotate.mjs — Regenerate a classic GitHub PAT
//
// Assumes GITHUB_USERNAME and GITHUB_PASSWORD env vars are set.
// Logs in, navigates to the classic tokens page, regenerates a named token,
// and outputs TOKEN:<value> on the last line for the calling task to capture.
//
// Usage: browser run --headed ./scripts/github/token-rotate.mjs -- <token-name> [login-id]

import { login } from './login.mjs';
import { record } from '../record.mjs';
import {
  findClassicTokenByName,
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
  await login(page, { agent: loginId, username, password });

  // --- Navigate to classic tokens page ---
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

  // --- Find the token by exact visible name ---
  const tokens = await listClassicTokens(page);
  const token = findClassicTokenByName(tokens, tokenName);
  if (!token) {
    console.error(`Token named "${tokenName}" not found.`);
    console.error(`Found ${tokens.length} token(s) on page:`);
    for (const visibleToken of tokens) {
      console.error(`  - ${visibleToken.id}\t${visibleToken.name}`);
    }
    process.exit(1);
  }

  const tokenId = token.id;
  if (!tokenId) {
    console.error(`Could not extract token ID for token: ${tokenName}`);
    process.exit(1);
  }

  console.log(`Found token "${tokenName}" (ID: ${tokenId}). Regenerating...`);

  // --- Regenerate ---
  await page.goto(`https://github.com/settings/tokens/${tokenId}/regenerate`);
  await page.waitForLoadState('domcontentloaded');
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
  await regenerateBtn.waitFor({ state: 'visible', timeout: 5000 });
  await regenerateBtn.click();

  // Wait for the new token to appear (wait for the token display element instead of a fixed sleep)
  await page.waitForLoadState('domcontentloaded');
  const tokenDisplayLocator = page.locator('input#new-oauth-token, [data-clipboard-text^="ghp_"]').first();
  await tokenDisplayLocator.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
    console.error('Warning: token display element not found within timeout, will try fallback methods.');
  });
  record(`regenerated-page-${loginId}.html`, await page.content());

  // --- Capture the new token ---
  let newToken = null;

  // Method 1: input#new-oauth-token (GitHub's token display input)
  const tokenInput = page.locator('input#new-oauth-token');
  if (await tokenInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    newToken = await tokenInput.getAttribute('value');
  }

  // Method 2: data-clipboard-text attribute (GitHub's copy button)
  if (!newToken) {
    const clipboardEl = page.locator('[data-clipboard-text^="ghp_"]').first();
    if (await clipboardEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      newToken = await clipboardEl.getAttribute('data-clipboard-text');
    }
  }

  // Method 3: search full page text
  if (!newToken) {
    const pageText = await page.textContent('body');
    newToken = parseTokenFromText(pageText);
  }

  if (!newToken || !newToken.startsWith('ghp_')) {
    console.error('Could not capture new token from page.');
    console.error('The token may have been regenerated — check the browser window.');
    process.exit(1);
  }

  console.log('Token regenerated successfully.');
  console.log(`TOKEN:${newToken}`);
}
