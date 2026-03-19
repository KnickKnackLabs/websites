// home.mjs — Extract Mercury dashboard data (balances, accounts)
//
// Usage: shimmer browser:run -s mercury.com ./scripts/mercury/home.mjs

import { record } from '../record.mjs';

export const site = 'mercury.com';

// --- Pure functions (testable) ---

export function normalizeText(str) {
  return str.replace(/\s+/g, ' ').trim();
}

// --- Script entry point ---

export default async function({ page }) {
  await page.goto('https://app.mercury.com/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Dismiss any popups
  await page.keyboard.press('Escape');

  record('mercury-home.html', await page.content());

  const data = await page.evaluate(() => {
    const greeting = document.querySelector('h1')?.innerText?.trim() || '';

    // Account cards — look for balance displays
    const accounts = [];
    const accountRows = document.querySelectorAll('[class*="Accounts"] [class*="account"], [class*="account-row"], tr');
    // Fallback: extract from the accounts section
    const accountSection = [...document.querySelectorAll('h2, h3')]
      .find(h => h.innerText?.includes('Accounts'));
    if (accountSection) {
      const container = accountSection.closest('div[class]');
      const items = container?.querySelectorAll('a, div[role="button"], [class*="row"]') || [];
      items.forEach(item => {
        const text = item.innerText?.trim();
        if (text && text.includes('$')) {
          accounts.push(text);
        }
      });
    }

    // Mercury balance (main display)
    const balanceEl = [...document.querySelectorAll('h2, [class*="balance"], [class*="Balance"]')]
      .find(el => el.innerText?.includes('Mercury balance'));
    const balanceContainer = balanceEl?.closest('div[class]');
    const balance = balanceContainer?.innerText?.trim() || '';

    // Credit card section
    const creditEl = [...document.querySelectorAll('h3, h2, [class*="card"]')]
      .find(el => el.innerText?.includes('Credit Card'));
    const creditContainer = creditEl?.closest('div[class]');
    const creditCard = creditContainer?.innerText?.trim() || '';

    // Summary stats (money in / money out)
    const statsText = [...document.querySelectorAll('[class*="stat"], [class*="summary"]')]
      .map(el => el.innerText?.trim())
      .filter(t => t && t.includes('$'))
      .join(' | ');

    return { greeting, balance, accounts, creditCard, stats: statsText };
  });

  console.log(JSON.stringify(data));
}
