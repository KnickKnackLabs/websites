// home.mjs — Extract Gusto dashboard data (tasks, payments, upcoming)
//
// Navigates to the Gusto home page and extracts structured data about
// pending tasks, payment status, and upcoming deadlines.
//
// Usage: browser run ./scripts/gusto/home.mjs

import { record } from '../record.mjs';

export const site = 'gusto.com';

// --- Pure functions (testable) ---

// Parse task card text into structured fields.
// Input is the innerText of a task card div, e.g.:
//   "Due Apr 14\nRun payroll\nTime to make employees happy..."
export function parseTaskText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && l !== 'Start >' && l !== 'Start');
  const dueLine = lines.find(l => /^Due\s/.test(l));
  const due = dueLine ? dueLine.replace(/^Due\s+/, '') : null;
  const rest = lines.filter(l => l !== dueLine);
  return {
    title: rest[0] || null,
    description: rest.slice(1).join(' ') || null,
    due,
  };
}

// --- Script entry point ---

export default async function({ page }) {
  await page.goto('https://app.gusto.com', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  record('gusto-home.html', await page.content());

  const data = await page.evaluate(() => {
    // Greeting
    const greeting = document.querySelector('h1')?.innerText?.trim() || '';

    // Tasks — each task card is a div inside .notification-list
    const taskCards = document.querySelectorAll('.notification-list > div');
    const tasks = [...taskCards].map(card => card.innerText?.trim()).filter(Boolean);

    // Sidebar sections (Payments, Upcoming)
    const sidebarSections = document.querySelectorAll('aside.side-pane section[role="group"]');
    const sidebar = [];
    sidebarSections.forEach(section => {
      const heading = section.querySelector('h2, h3')?.innerText?.trim();
      // Skip promo/referral sections
      if (!heading || heading.includes('referral') || heading.includes('Earn')) return;
      // Get content without heading text
      const body = [...section.children]
        .filter(el => !el.matches('h2, h3'))
        .map(el => el.innerText?.trim())
        .filter(Boolean)
        .join('\n');
      sidebar.push({ heading, body });
    });

    return { greeting, tasks, sidebar };
  });

  // Parse tasks into structured objects
  const tasks = data.tasks.map(t => parseTaskText(t));

  const result = {
    greeting: data.greeting,
    tasks,
    sidebar: data.sidebar,
  };

  console.log(JSON.stringify(result));
}
