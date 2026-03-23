// headlines.mjs — Extract headlines from the NYTimes front page
//
// Usage: shimmer browser:run ./scripts/nytimes/headlines.mjs

import { record } from '../record.mjs';

// --- Pure functions (testable) ---

// Clean up headline text — collapse whitespace, trim
export function cleanHeadline(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// --- Script entry point ---

export default async function({ page, args }) {
  console.error('Navigating to nytimes.com...');
  await page.goto('https://www.nytimes.com');
  await page.waitForLoadState('domcontentloaded');

  // Wait for content to render
  await page.waitForTimeout(2000);

  record('nytimes-front.html', await page.content());

  // Extract headlines — NYTimes uses various heading and story elements
  const headlines = [];
  const seen = new Set();

  // Strategy: find story links with substantial text
  const storyLinks = page.locator('section a, article a, [data-testid="block-link"] a, h2 a, h3 a');
  const count = await storyLinks.count();

  for (let i = 0; i < count && headlines.length < 30; i++) {
    try {
      const el = storyLinks.nth(i);
      const text = cleanHeadline(await el.textContent());
      const href = await el.getAttribute('href');

      // Filter: must be substantial text (not nav links), must have an article href
      if (text.length > 20 && text.length < 300 && href && href.includes('/202') && !seen.has(text)) {
        seen.add(text);
        headlines.push({
          title: text,
          url: href.startsWith('http') ? href : `https://www.nytimes.com${href}`
        });
      }
    } catch {
      continue;
    }
  }

  record('extracted-headlines.json', JSON.stringify(headlines, null, 2));

  console.error(`Extracted ${headlines.length} headlines.`);
  console.log(JSON.stringify(headlines));
}
