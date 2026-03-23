// project-view.mjs — Extract items from a GitHub Project board view
//
// Navigates to a GitHub Projects v2 board, extracts all visible items
// with their field values, and outputs them as a JSON array.
//
// Usage: shimmer browser:run -s github.com ./scripts/github/project-view.mjs -- <owner> <project-number> [view-name]

import { login } from './login.mjs';
import { record } from '../record.mjs';

// --- Pure functions (testable) ---

// Parse a repo#number reference from an issue URL path.
// e.g. "/KnickKnackLabs/shimmer/issues/608" → { repo: "KnickKnackLabs/shimmer", number: 608 }
export function parseIssueRef(urlPath) {
  const match = urlPath.match(/\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  if (!match) return null;
  return { repo: match[1], number: parseInt(match[2], 10) };
}

// --- Script entry point ---

export default async function({ page, args }) {
  // shimmer browser:run prepends the subcommand name ("run") as args[0]
  const scriptArgs = args.slice(1);
  const owner = scriptArgs[0];
  const projectNumber = scriptArgs[1];
  const viewName = scriptArgs[2]; // optional

  if (!owner || !projectNumber) {
    console.error('Usage: project-view.mjs <owner> <project-number> [view-name]');
    process.exit(1);
  }

  // --- Navigate to project ---
  const projectUrl = `https://github.com/orgs/${owner}/projects/${projectNumber}`;
  console.error(`Navigating to ${projectUrl}...`);
  await page.goto(projectUrl);
  await page.waitForLoadState('domcontentloaded');

  // --- Login if needed (URL redirect or inline sign-in prompt) ---
  const pageText = await page.textContent('body').catch(() => '');
  if (page.url().includes('/login') || pageText.includes('Sign in to GitHub')) {
    console.error('Not authenticated. Logging in...');
    const username = process.env.GITHUB_USERNAME;
    const password = process.env.GITHUB_PASSWORD;
    if (!username || !password) {
      console.error('GITHUB_USERNAME and GITHUB_PASSWORD env vars required (no saved auth session)');
      process.exit(1);
    }
    await login(page, { agent: owner, username, password });
    // Retry navigation after login
    await page.goto(projectUrl);
    await page.waitForLoadState('domcontentloaded');
  }

  // Wait for the project board to render (React SPA — DOM loads before content)
  console.error('Waiting for project board to render...');
  await page.waitForSelector('[role="row"]', { timeout: 15000 }).catch(() => {
    // Fallback: try waiting for any issue link
    return page.waitForSelector('a[href*="/issues/"]', { timeout: 5000 }).catch(() => {
      console.error('Warning: no rows or issue links found. Board may be empty or still loading.');
    });
  });

  record('project-board.html', await page.content());

  // --- Switch view if requested ---
  if (viewName) {
    console.error(`Looking for view: ${viewName}...`);

    // Views appear as tabs/links in the project header
    const viewTab = page.locator(`[role="tab"]:has-text("${viewName}"), a:has-text("${viewName}")`).first();
    if (await viewTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await viewTab.click();
      await page.waitForLoadState('domcontentloaded');
      console.error(`Switched to view: ${viewName}`);
    } else {
      console.error(`View "${viewName}" not found. Using default view.`);
    }
    record(`project-view-${viewName}.html`, await page.content());
  }

  // --- Extract items ---
  // GitHub Projects v2 table view renders rows with role="row".
  // Each row contains cells with the item's field values.
  // We try multiple strategies to handle different view types.

  const items = [];

  // Strategy 1: Table view — GitHub Projects v2 uses role="row" with role="gridcell"
  // Skip the first row (header) by filtering for rows that contain issue links
  const rows = page.locator('[role="row"]');
  const rowCount = await rows.count().catch(() => 0);

  if (rowCount > 1) { // >1 because first row is header
    // Read column headers from the first row
    const headerRow = rows.nth(0);
    const headerCells = headerRow.locator('[role="columnheader"]');
    const headerCount = await headerCells.count();
    const columnNames = [];
    for (let i = 0; i < headerCount; i++) {
      columnNames.push((await headerCells.nth(i).textContent()).trim());
    }
    console.error(`Columns: ${columnNames.join(', ')}`);

    console.error(`Found ${rowCount - 1} table rows. Extracting...`);

    for (let i = 1; i < rowCount; i++) { // skip header row
      const row = rows.nth(i);
      const item = await extractTableRow(row, page, columnNames);
      if (item) items.push(item);
    }
  }

  // Strategy 2: If no table rows found, try board view cards
  if (items.length === 0) {
    const cards = page.locator('[data-testid="board-view-column-card"], [data-board-card]');
    const cardCount = await cards.count().catch(() => 0);

    if (cardCount > 0) {
      console.error(`Found ${cardCount} board cards. Extracting...`);

      for (let i = 0; i < cardCount; i++) {
        const card = cards.nth(i);
        const item = await extractBoardCard(card, page);
        if (item) items.push(item);
      }
    }
  }

  // Strategy 3: Fallback — try to find any issue links on the page
  if (items.length === 0) {
    console.error('No table rows or board cards found. Trying fallback: issue links...');

    const issueLinks = page.locator('a[href*="/issues/"]');
    const linkCount = await issueLinks.count();

    for (let i = 0; i < linkCount; i++) {
      const link = issueLinks.nth(i);
      const href = await link.getAttribute('href');
      const text = await link.textContent();
      const ref = parseIssueRef(href);

      if (ref && text.trim()) {
        items.push({
          title: text.trim(),
          number: ref.number,
          repo: ref.repo,
          status: null,
          assignees: [],
          fields: {}
        });
      }
    }

    // Deduplicate by repo#number
    const seen = new Set();
    const deduped = items.filter(item => {
      const key = `${item.repo}#${item.number}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    items.length = 0;
    items.push(...deduped);
  }

  record('extracted-items.json', JSON.stringify(items, null, 2));

  console.error(`Extracted ${items.length} items.`);

  // Output JSON array on stdout (the mise task captures this)
  console.log(JSON.stringify(items));
}

// Extract an item from a table view row.
// columnNames: array of header labels read from the header row.
async function extractTableRow(row, page, columnNames = []) {
  try {
    // The first cell usually contains the issue title with a link
    const titleLink = row.locator('a[href*="/issues/"]').first();
    if (!await titleLink.isVisible({ timeout: 1000 }).catch(() => false)) {
      return null;
    }

    const href = await titleLink.getAttribute('href');
    const title = (await titleLink.textContent()).trim();
    const ref = parseIssueRef(href);

    if (!ref) return null;

    // Extract all gridcell text content and map to column names
    const cells = row.locator('[role="gridcell"]');
    const cellCount = await cells.count();
    const fields = {};
    for (let i = 0; i < cellCount; i++) {
      const text = (await cells.nth(i).textContent()).trim();
      const colName = columnNames[i];
      if (colName && text) {
        fields[colName] = text;
      }
    }

    // Try to find assignees (avatar images with alt text)
    const assigneeEls = row.locator('img[alt^="@"]');
    const assigneeCount = await assigneeEls.count();
    const assignees = [];
    for (let i = 0; i < assigneeCount; i++) {
      const alt = await assigneeEls.nth(i).getAttribute('alt');
      if (alt) assignees.push(alt.replace(/^@/, ''));
    }

    // Status comes from whatever column is named "Status"
    const status = fields['Status'] || null;

    return {
      title,
      number: ref.number,
      repo: ref.repo,
      status,
      assignees,
      fields
    };
  } catch (err) {
    console.error(`Failed to extract row: ${err.message}`);
    return null;
  }
}

// Extract an item from a board view card.
async function extractBoardCard(card, page) {
  try {
    const titleLink = card.locator('a[href*="/issues/"]').first();
    if (!await titleLink.isVisible({ timeout: 1000 }).catch(() => false)) {
      return null;
    }

    const href = await titleLink.getAttribute('href');
    const title = (await titleLink.textContent()).trim();
    const ref = parseIssueRef(href);

    if (!ref) return null;

    // Board cards are positioned within a column — the column header is the status
    // Try to find the parent column's header
    const column = card.locator('xpath=ancestor::*[@data-testid="board-view-column"]').first();
    let status = null;
    if (await column.isVisible({ timeout: 1000 }).catch(() => false)) {
      const header = column.locator('[data-testid="column-header"], h3, [role="heading"]').first();
      status = await header.textContent().catch(() => null);
    }

    // Assignees
    const assigneeEls = card.locator('img[alt^="@"]');
    const assigneeCount = await assigneeEls.count();
    const assignees = [];
    for (let i = 0; i < assigneeCount; i++) {
      const alt = await assigneeEls.nth(i).getAttribute('alt');
      if (alt) assignees.push(alt.replace(/^@/, ''));
    }

    return {
      title,
      number: ref.number,
      repo: ref.repo,
      status: status ? status.trim() : null,
      assignees,
      fields: {}
    };
  } catch (err) {
    console.error(`Failed to extract card: ${err.message}`);
    return null;
  }
}
