// transactions.mjs — Extract transactions from Mercury
//
// Navigates to the Transactions page and extracts the table data.
//
// Usage: shimmer browser:run -s mercury.com ./scripts/mercury/transactions.mjs

import { record } from '../record.mjs';

export const site = 'mercury.com';

// --- Script entry point ---

export default async function({ page }) {
  await page.goto('https://app.mercury.com/transactions', { waitUntil: 'domcontentloaded' });

  // Wait for transaction rows to load
  // Mercury uses CSS module classes with `date` in the class name
  await page.locator('table tbody tr').first()
    .waitFor({ state: 'visible', timeout: 30000 });

  // Dismiss any popups
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');

  record('mercury-transactions.html', await page.content());

  // Extract using Mercury's CSS module column classes
  const transactions = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    return [...rows].map(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 6) return null;

      // Mercury columns: checkbox, date, toFrom, amount, account, method, category, attachment
      // Find cells by class name patterns
      const findCell = (pattern) => {
        for (const td of cells) {
          if (td.className.includes(pattern)) return td.innerText?.trim();
        }
        return '';
      };

      const date = findCell('date_');
      let toFrom = findCell('toFrom_');
      const amount = findCell('amount_');
      const account = findCell('account_');
      const method = findCell('method_');
      let category = findCell('customCategory_') || findCell('Category');

      // Clean up: toFrom has avatar initials on their own line
      toFrom = toFrom.split('\n').filter(l => l.length > 1).join(' ').trim();
      // Clean up: category has combobox menu text
      category = category.split('\n')[0].trim();
      if (category === 'Category') category = '';

      if (!date) return null;
      return { date, toFrom, amount, account, method, category };
    }).filter(Boolean);
  });

  console.log(JSON.stringify(transactions));
}
