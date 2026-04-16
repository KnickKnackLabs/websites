// home.mjs — Extract Mercury dashboard data (balances, accounts)
//
// Usage: browser run -s mercury.com ./scripts/mercury/home.mjs

import { record } from '../record.mjs';
import { isMercuryAuthPage } from './auth.mjs';

export const site = 'mercury.com';

// --- Pure functions (testable) ---

// Parse an account line like "Checking ••9145  $4,593.59" into structured data.
export function parseAccountLine(text) {
  const match = text.match(/^(.+?)\s+(\$[\d,.]+)$/);
  if (!match) return null;
  return { name: match[1].trim(), balance: match[2] };
}

// --- Script entry point ---

export default async function({ page }) {
  await page.goto('https://app.mercury.com/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Dismiss any popups
  await page.keyboard.press('Escape');

  const html = await page.content();
  record('mercury-home.html', html);

  const currentUrl = page.url();
  const pageText = await page.locator('body').innerText().catch(() => '');
  const title = await page.title().catch(() => '');
  if (isMercuryAuthPage(currentUrl, `${title}\n${pageText}\n${html}`)) {
    throw new Error('Mercury auth missing or expired. Run: mise run mercury:activate');
  }

  const data = await page.evaluate(() => {
    // Greeting
    const greeting = document.querySelector('h1')?.innerText?.trim() || '';

    // Get all text from the dashboard content area (not the sidebar nav)
    const content = document.querySelector('[class*="dashboardContentWrapper"]')
      || document.querySelector('[class*="page-content"]')
      || document.querySelector('main');
    const fullText = content?.innerText || '';

    // Extract Mercury balance — look for the dollar amount after "Mercury balance"
    let mercuryBalance = '';
    const balanceMatch = fullText.match(/Mercury balance[^\$]*(\$[\d,.]+)/);
    if (balanceMatch) mercuryBalance = balanceMatch[1];

    // Extract account list — look for account names followed by dollar amounts
    const accounts = [];
    const accountPatterns = [
      /Credit Card\s+(\$[\d,.]+)/,
      /Checking\s+[•·]+\s*\d+\s+(\$[\d,.]+)/,
      /Savings\s+[•·]+\s*\d+\s+(\$[\d,.]+)/,
    ];
    for (const pat of accountPatterns) {
      const m = fullText.match(pat);
      if (m) {
        const name = pat.source.split('\\s')[0];
        accounts.push({ name, balance: m[1] });
      }
    }

    // Fallback: find the Accounts section and extract lines
    if (accounts.length === 0) {
      const accountLines = fullText.split('\n')
        .filter(l => l.match(/\$[\d,.]+/) && (l.includes('Checking') || l.includes('Savings') || l.includes('Credit')));
      accountLines.forEach(line => {
        const parts = line.trim().split(/\s{2,}/);
        if (parts.length >= 2) {
          accounts.push({ name: parts[0], balance: parts[parts.length - 1] });
        }
      });
    }

    // Credit card details
    let creditCard = null;
    const creditMatch = fullText.match(/Credit Card\s*\n\s*(\$[\d,.]+)[\s\S]*?(\$[\d,.]+ available)/);
    if (creditMatch) {
      creditCard = { balance: creditMatch[1], available: creditMatch[2] };
    }

    // Money flow stats
    let moneyIn = '';
    let moneyOut = '';
    const inMatch = fullText.match(/[↗→]?\s*(\$[\d,.]+K?)\s/);
    const flowMatch = fullText.match(/(\$[\d,.]+K?)\s+[↘↓]?\s*[~−-]?(\$[\d,.]+K?)/);
    if (flowMatch) {
      moneyIn = flowMatch[1];
      moneyOut = flowMatch[2];
    }

    return { greeting, mercuryBalance, accounts, creditCard, moneyIn, moneyOut };
  });

  console.log(JSON.stringify(data));
}
