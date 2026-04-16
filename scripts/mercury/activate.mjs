// activate.mjs — Activate Mercury access from an invite URL

import { record } from '../record.mjs';
import { isAuthenticatedMercuryUrl, isMercuryAuthPage } from './auth.mjs';

function normalizeText(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

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

async function detectState(page) {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const html = await page.content();
  const text = normalizeText(`${title}\n${bodyText}`);

  if (isAuthenticatedMercuryUrl(url) && !isMercuryAuthPage(url, `${title}\n${bodyText}\n${html}`)) {
    return { state: 'authenticated', url, title, bodyText, html };
  }

  const visiblePasswordFields = await page.locator('input[type="password"]')
    .evaluateAll(nodes => nodes.filter(node => node.offsetParent !== null).length)
    .catch(() => 0);

  const hasPrimaryButton = /continue|next|create password|set password|get started|activate|submit/.test(text);

  if (visiblePasswordFields > 0 && hasPrimaryButton) {
    return { state: 'password-setup', url, title, bodyText, html };
  }

  if (/two-factor authentication|verification code|enter code|passkey|security key|authenticator/.test(text)) {
    return { state: 'verification', url, title, bodyText, html };
  }

  if (url.includes('/login') || /forgot password|log in securely|continue with passkey/.test(text)) {
    return { state: 'plain-login', url, title, bodyText, html };
  }

  if (isMercuryAuthPage(url, `${title}\n${bodyText}\n${html}`)) {
    return { state: 'auth-flow', url, title, bodyText, html };
  }

  return { state: 'unknown', url, title, bodyText, html };
}

async function clickPrimarySubmit(page) {
  const candidates = [
    'button[type="submit"]',
    'button:has-text("Continue")',
    'button:has-text("Next")',
    'button:has-text("Create password")',
    'button:has-text("Set password")',
    'button:has-text("Get started")',
    'button:has-text("Activate")',
    'input[type="submit"]',
  ];

  for (const selector of candidates) {
    const button = page.locator(selector).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return selector;
    }
  }

  return null;
}

async function waitForActivation(page, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const detected = await detectState(page);
    if (detected.state === 'authenticated') {
      return detected.url;
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

  let detected = await detectState(page);
  record('mercury-activate-initial.html', detected.html);

  if (detected.state === 'authenticated') {
    console.error(`Mercury already authenticated: ${detected.url}`);
    record('mercury-activate-authenticated.html', detected.html);
    return;
  }

  if (detected.state === 'password-setup') {
    if (!password) {
      console.error('No password supplied. Complete password setup manually in the browser.');
    } else {
      const filled = await fillVisiblePasswordFields(page, password);
      if (filled > 0) {
        console.error(`Filled ${filled} Mercury password field(s).`);
        record('mercury-activate-password-filled.html', await page.content());

        const clicked = await clickPrimarySubmit(page);
        if (clicked) {
          console.error(`Submitted Mercury password step via ${clicked}.`);
          await page.waitForTimeout(1500);
        } else {
          console.error('Could not find a clear submit button after filling password. Continue manually.');
        }
      } else {
        console.error('Password was provided, but no visible password fields were found. Continue manually.');
      }
    }
  } else if (detected.state === 'plain-login') {
    throw new Error('Mercury invite did not land on an activation step; reached plain login instead. Retry with a fresh invite flow or reset the account state.');
  } else if (detected.state === 'verification' || detected.state === 'auth-flow') {
    console.error('Mercury is already mid-onboarding. Continue with the visible verification/setup step.');
  } else {
    console.error(`Mercury activation reached an unexpected state (${detected.state}). Continue manually if the page looks correct.`);
  }

  console.error('Complete any remaining Mercury steps (2FA, profile/compliance prompts).');
  console.error('Waiting until Mercury lands in the authenticated app...');

  const finalUrl = await waitForActivation(page);
  record('mercury-activate-authenticated.html', await page.content());
  console.error(`Mercury activation complete: ${finalUrl}`);
}
