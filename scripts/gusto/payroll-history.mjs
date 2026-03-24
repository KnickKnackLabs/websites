// payroll-history.mjs — Extract payroll history from Gusto
//
// Navigates to Pay > Pay History and extracts the payroll table data.
// Returns structured JSON with each payroll run's details.
//
// Usage: browser run ./scripts/gusto/payroll-history.mjs

import { record } from '../record.mjs';
import { normalizeText } from '../utils.mjs';

export const site = 'gusto.com';

// --- Pure functions (testable) ---

// Extract just the status label (e.g. "Complete") from a status cell
// that may contain extra action links like "Adjust payroll".
export function parseStatus(text) {
  const normalized = normalizeText(text);
  const statuses = ['Complete', 'Pending', 'Processing', 'Failed', 'Canceled', 'Reversed'];
  for (const s of statuses) {
    if (normalized.includes(s)) return s;
  }
  return normalized;
}

// Parse a payroll table row's text content into structured data.
// Expected columns: Payday, Type, Pay period, Funding, Status, Total
export function parsePayrollRow(cells) {
  if (cells.length < 6) return null;
  return {
    payday: normalizeText(cells[0]),
    type: normalizeText(cells[1]),
    payPeriod: normalizeText(cells[2]),
    funding: normalizeText(cells[3]),
    status: parseStatus(cells[4]),
    total: normalizeText(cells[5]),
  };
}

// Parse a dollar amount string to cents (integer).
export function parseDollars(str) {
  const cleaned = str.replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.round(num * 100);
}

// --- Script entry point ---

export default async function({ page }) {
  // Navigate to Pay page
  await page.goto('https://app.gusto.com/payroll_admin/pay', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  record('gusto-pay-page.html', await page.content());

  // Click "View pay history"
  const historyLink = page.locator('text=View pay history').first();
  await historyLink.waitFor({ state: 'visible', timeout: 10000 });
  await historyLink.click();

  // Wait for actual data rows to load (table appears immediately with a loading spinner)
  await page.locator('table tbody tr td[role="rowheader"]').first()
    .waitFor({ state: 'visible', timeout: 30000 });
  record('gusto-pay-history.html', await page.content());

  // Extract table data
  const payrolls = await page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return [];

    const rows = [...table.querySelectorAll('tbody tr')];
    return rows.map(row => {
      const cells = [...row.querySelectorAll('td')].map(td => td.innerText?.trim());
      return cells;
    });
  });

  const parsed = payrolls
    .map(cells => parsePayrollRow(cells))
    .filter(Boolean);

  console.log(JSON.stringify(parsed));
}
