// tokens.mjs — Helpers for GitHub classic PAT pages

export const GITHUB_TOKEN_PATTERN = /(gh[pousr]_[a-zA-Z0-9_]+|github_pat_[a-zA-Z0-9_]+)/;

export function isGitHubToken(value) {
  return GITHUB_TOKEN_PATTERN.test(String(value || ''));
}

// Extract a GitHub PAT from page text or HTML.
export function parseTokenFromText(text) {
  const match = String(text || '').match(GITHUB_TOKEN_PATTERN);
  return match ? match[1] : null;
}

// Extract a token ID from a /settings/tokens/<id> href.
export function parseTokenId(href) {
  const match = href.match(/\/tokens\/(\d+)/);
  return match ? match[1] : null;
}

function normalizeText(text) {
  return (text || '').trim().replace(/\s+/g, ' ');
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export async function listClassicTokens(page) {
  const tokenRows = page.locator('.access-token[data-id]');
  const rowCount = await tokenRows.count();
  const tokens = [];

  for (let i = 0; i < rowCount; i++) {
    const row = tokenRows.nth(i);
    const id = await row.getAttribute('data-id');
    if (!id) continue;

    const nameLink = row.locator('.token-description strong a[href*="/settings/tokens/"]').first();
    const href = await nameLink.getAttribute('href');
    const parsedId = parseTokenId(href || '');
    const name = normalizeText(await nameLink.textContent());
    if (!name) continue;

    const status = unique(
      (await row.locator('.color-fg-attention, .last-used').allTextContents())
        .map(normalizeText)
    );

    tokens.push({ id: parsedId || id, name, status });
  }

  return tokens;
}

export function findClassicTokenByName(tokens, name) {
  return tokens.find(token => token.name === name) || null;
}
