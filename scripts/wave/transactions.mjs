// transactions.mjs — Extract transactions from Wave
//
// Navigates to the Transactions page and extracts the transaction table.
// Returns structured JSON with each transaction's details.
//
// Usage: shimmer browser:run -s waveapps.com ./scripts/wave/transactions.mjs

import { record } from '../record.mjs';
import { normalizeText } from '../utils.mjs';
import { parseBusinessId } from './utils.mjs';

export const site = 'waveapps.com';

// --- Script entry point ---

export default async function({ page }) {
  // Navigate to Wave — will redirect to dashboard with business ID
  await page.goto('https://next.waveapps.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000); // Let redirect settle

  // Extract business ID from the URL
  const businessId = parseBusinessId(page.url());
  if (!businessId) {
    console.error('Could not determine business ID from URL: ' + page.url());
    process.exit(1);
  }

  // Navigate to Transactions
  await page.goto(`https://next.waveapps.com/${businessId}/transactions`, { waitUntil: 'domcontentloaded' });

  // Wait for actual transaction rows (not the loading spinner)
  await page.locator('.transactions-list-v2__row').first()
    .waitFor({ state: 'visible', timeout: 30000 });

  // Dismiss any popups
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');

  record('wave-transactions.html', await page.content());

  // Extract transactions using Wave's specific cell classes
  const transactions = await page.evaluate(() => {
    const rows = document.querySelectorAll('.transactions-list-v2__row');
    return [...rows].map(row => {
      const date = row.querySelector('.transactions-list-v2__row__date-cell')?.innerText?.trim();
      const description = row.querySelector('.transactions-list-v2__row__description-cell')?.innerText?.trim();
      const account = row.querySelector('.transactions-list-v2__row__account-cell')?.innerText?.trim();
      const category = row.querySelector('.transactions-list-v2__row__category-cell')?.innerText?.trim();
      const amount = row.querySelector('.transactions-list-v2__row__amount-cell')?.innerText?.trim();
      if (!date) return null;
      return { date, description, account, category, amount };
    }).filter(Boolean);
  });

  console.log(JSON.stringify(transactions));
}
