// activate.mjs — Activate Mercury access from an invite URL

import { record } from '../record.mjs';
import { isAuthenticatedMercuryUrl, isMercuryAuthPage } from './auth.mjs';

export const site = 'mercury.com';

function parseArgs(args) {
  let inviteUrl = null;
  let password = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--password' && args[i + 1]) {
      password = args[++i];
      continue;
    }

    if (!inviteUrl) inviteUrl = args[i];
  }

  return { inviteUrl, password };
}

async function fillVisiblePasswordFields(page, password) {
  const fields = page.locator('input[type="password"]');
  const count = await fields.count();
  let filled = 0;

  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    if (await field.isVisible().catch(() => false)) {
      await field.fill(password);
      filled += 1;
      if (filled >= 2) break;
    }
  }

  return filled;
}

async function waitForActivation(page, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const currentUrl = page.url();
    const bodyText = await page.locator('body').innerText().catch(() => '');

    if (isAuthenticatedMercuryUrl(currentUrl) && !isMercuryAuthPage(currentUrl, bodyText)) {
      return currentUrl;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error('Timed out waiting for Mercury activation to complete. Finish onboarding in the browser and retry `mise run mercury:activate --keep` if needed.');
}

export default async function({ page, args }) {
  const { inviteUrl, password } = parseArgs(args);
  if (!inviteUrl) {
    throw new Error('Missing invite URL. Pass it as the first positional argument.');
  }

  console.error('Opening Mercury invite...');
  await page.goto(inviteUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  record('mercury-activate-initial.html', await page.content());

  if (password) {
    const filled = await fillVisiblePasswordFields(page, password);
    if (filled > 0) {
      console.error(`Filled ${filled} Mercury password field(s). Review and submit in the browser.`);
      record('mercury-activate-password-filled.html', await page.content());
    } else {
      console.error('Password was provided, but no visible password fields were found. Continue manually.');
    }
  } else {
    console.error('No password supplied. Complete password setup manually in the browser.');
  }

  console.error('Complete any remaining Mercury steps (submit, 2FA, profile/compliance prompts).');
  console.error('Waiting until Mercury lands in the authenticated app...');

  const finalUrl = await waitForActivation(page);
  record('mercury-activate-authenticated.html', await page.content());
  console.error(`Mercury activation complete: ${finalUrl}`);
}
