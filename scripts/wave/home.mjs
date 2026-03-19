// home.mjs — Extract Wave dashboard data (cash flow, P&L summaries)
//
// Navigates to the Wave dashboard and extracts summary information.
//
// Usage: shimmer browser:run -s waveapps.com ./scripts/wave/home.mjs

import { record } from '../record.mjs';

export const site = 'waveapps.com';

// --- Pure functions (testable) ---

// Extract business ID from a Wave URL.
export function parseBusinessId(url) {
  const match = url.match(/waveapps\.com\/([a-f0-9-]{36})/);
  return match ? match[1] : null;
}

// --- Script entry point ---

export default async function({ page }) {
  await page.goto('https://next.waveapps.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000); // Let SPA render

  // Dismiss any popups
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');

  record('wave-home.html', await page.content());

  const data = await page.evaluate(() => {
    const businessName = document.querySelector('[class*="business-name"], [class*="company"]')?.innerText?.trim()
      || document.querySelector('header')?.innerText?.match(/Knick Knack Labs/)?.[0]
      || '';

    // Account balance from the "All accounts" dropdown
    const accountBalance = document.querySelector('[class*="account"] [class*="balance"], select option')?.innerText?.trim() || '';

    // Extract chart sections — look for headings like "Cash Flow", "Profit And Loss"
    const sections = [];
    const headings = document.querySelectorAll('h2, h3');
    headings.forEach(h => {
      const title = h.innerText?.trim();
      if (!title || title === 'Things You Can Do') return;
      const container = h.closest('section, div[class]');
      if (!container) return;
      // Get any summary text or links
      const links = [...container.querySelectorAll('a')].map(a => ({
        text: a.innerText?.trim(),
        href: a.href,
      })).filter(l => l.text && l.text !== title);
      sections.push({ title, links });
    });

    // "Things You Can Do" quick actions
    const actions = [...document.querySelectorAll('a')]
      .filter(a => {
        const parent = a.closest('section, div');
        return parent?.querySelector('h2, h3')?.innerText?.includes('Things You Can Do');
      })
      .map(a => a.innerText?.trim())
      .filter(Boolean);

    return { businessName, accountBalance, sections, actions };
  });

  console.log(JSON.stringify(data));
}
