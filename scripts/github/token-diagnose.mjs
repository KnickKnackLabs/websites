// token-diagnose.mjs — Non-mutating safe page-shape diagnostics for GitHub PAT pages.
//
// Usage: browser run ./scripts/github/token-diagnose.mjs -- <create|list|regenerate> [token-name] [login-id]

import { login } from './login.mjs';
import { tokenCreationUrl } from './token-create.mjs';
import { findClassicTokenByName, listClassicTokens } from './tokens.mjs';
import { logSafePageFacts } from './page-diagnostics.mjs';

export default async function({ page, args }) {
  const mode = args[0] || 'create';
  const tokenName = args[1] || process.env.WEBSITES_TOKEN_NAME || 'diagnostic-token';
  const loginId = args[2] || process.env.WEBSITES_LOGIN_ID || tokenName;

  const username = process.env.GITHUB_USERNAME;
  const password = process.env.GITHUB_PASSWORD;
  if (!username || !password) {
    console.error('GITHUB_USERNAME and GITHUB_PASSWORD env vars required');
    process.exit(1);
  }

  await login(page, { agent: loginId, username, password });

  if (mode === 'create') {
    await page.goto(tokenCreationUrl(tokenName));
  } else if (mode === 'list') {
    await page.goto('https://github.com/settings/tokens');
  } else if (mode === 'regenerate') {
    await page.goto('https://github.com/settings/tokens');
    await page.waitForLoadState('domcontentloaded');
    const token = findClassicTokenByName(await listClassicTokens(page), tokenName);
    if (!token?.id) {
      console.error(`Token named "${tokenName}" not found; printing list page diagnostics only.`);
      await logSafePageFacts(page, 'Safe GitHub token page diagnostics');
      return;
    }
    await page.goto(`https://github.com/settings/tokens/${token.id}/regenerate`);
  } else {
    console.error('Usage: mode must be one of create, list, regenerate');
    process.exit(1);
  }

  await page.waitForLoadState('domcontentloaded');
  await logSafePageFacts(page, 'Safe GitHub token page diagnostics');
}
