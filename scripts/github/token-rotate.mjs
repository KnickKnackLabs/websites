// token-rotate.mjs — Regenerate a classic GitHub PAT
//
// Assumes GITHUB_USERNAME and GITHUB_PASSWORD env vars are set.
// Logs in, navigates to the classic tokens page, regenerates the agent's token,
// and outputs TOKEN:<value> on the last line for the calling task to capture.
//
// Usage: shimmer browser:run --headed ./scripts/github/token-rotate.mjs -- <agent-name>

import { login } from './login.mjs';
import { record } from '../record.mjs';

// --- Pure functions (testable) ---

// Extract a classic PAT (ghp_...) from page text or HTML.
export function parseTokenFromText(text) {
  const match = text.match(/(ghp_[a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

// Extract a token ID from a /settings/tokens/<id> href.
export function parseTokenId(href) {
  const match = href.match(/\/tokens\/(\d+)/);
  return match ? match[1] : null;
}

// --- Script entry point ---

export default async function({ page, args }) {
  const agent = args[0];
  if (!agent) {
    console.error('Usage: pass agent name as first argument');
    process.exit(1);
  }

  const username = process.env.GITHUB_USERNAME;
  const password = process.env.GITHUB_PASSWORD;
  if (!username || !password) {
    console.error('GITHUB_USERNAME and GITHUB_PASSWORD env vars required');
    process.exit(1);
  }

  // --- Login ---
  await login(page, { agent, username, password });

  // --- Navigate to classic tokens page ---
  await page.goto('https://github.com/settings/tokens');
  await page.waitForLoadState('domcontentloaded');
  record(`tokens-page-${agent}.html`, await page.content());

  // --- Find the agent's token ---
  const tokenLink = page.locator(`a[href*="/settings/tokens/"]:has-text("${agent}")`).first();
  if (!await tokenLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.error(`Token named "${agent}" not found.`);

    const allTokenLinks = page.locator('a[href*="/settings/tokens/"]');
    const count = await allTokenLinks.count();
    console.error(`Found ${count} token(s) on page:`);
    for (let i = 0; i < count; i++) {
      const text = await allTokenLinks.nth(i).textContent();
      console.error(`  - ${text.trim()}`);
    }
    process.exit(1);
  }

  const tokenHref = await tokenLink.getAttribute('href');
  const tokenId = parseTokenId(tokenHref);
  if (!tokenId) {
    console.error(`Could not extract token ID from href: ${tokenHref}`);
    process.exit(1);
  }

  console.log(`Found token "${agent}" (ID: ${tokenId}). Regenerating...`);

  // --- Regenerate ---
  await page.goto(`https://github.com/settings/tokens/${tokenId}/regenerate`);
  await page.waitForLoadState('domcontentloaded');
  record(`regenerate-page-${agent}.html`, await page.content());

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
  record(`regenerated-page-${agent}.html`, await page.content());

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
