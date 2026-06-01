// two-factor.mjs — GitHub 2FA enrollment helpers

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { login, resolveSecretsBin } from './login.mjs';
import { tokenCreationUrl } from './token-create.mjs';

const SETUP_KEY_BUTTON = 'button:has-text("setup key")';
const ENABLE_2FA_BUTTON = 'button:has-text("Enable 2FA now"), input[value*="Enable 2FA"], a:has-text("Enable 2FA")';

export function extractTwoFactorSetupKey(text) {
  const value = String(text || '');
  const match = value.match(/Your two-factor secret\s+([A-Z2-7\s]+?)\s+to manually configure/i)
    || value.match(/Your two-factor secret\s+([A-Z2-7\s]{16,80})/i);
  if (!match) return null;

  const seed = match[1].replace(/\s+/g, '').toUpperCase();
  return /^[A-Z2-7]{16,80}$/.test(seed) ? seed : null;
}

export function extractRecoveryCodesFromText(text) {
  return [...new Set(String(text || '').match(/\b[a-z0-9]{5}-[a-z0-9]{5}\b/gi) || [])];
}

export function sanitizeTwoFactorText(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '[URL]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[GITHUB_TOKEN]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[GITHUB_TOKEN]')
    .replace(/\b[a-z0-9]{5}-[a-z0-9]{5}\b/gi, '[RECOVERY_CODE]')
    .replace(/[A-Z2-7]{8}(?:\s+[A-Z2-7]{4,8})+/g, '[BASE32_GROUPED]')
    .replace(/[A-Z2-7]{16,}/g, '[BASE32]')
    .replace(/\b\d{6,8}\b/g, '[CODE]');
}

async function textContent(page) {
  return await page.textContent('body').catch(() => '');
}

async function closeOpenDialogs(page) {
  await page.evaluate(() => {
    for (const dialog of document.querySelectorAll('dialog[open]')) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }).catch(() => {});
}

async function setOtpValue(page, code) {
  const otpInput = page.locator('input[name="otp"]').first();
  await otpInput.waitFor({ state: 'visible', timeout: 10000 });
  await otpInput.evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.focus();
  }, code);
}

async function clickEnabledContinueIfPresent(page) {
  return await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => {
      const text = candidate.innerText || candidate.value || candidate.getAttribute('aria-label') || '';
      const visible = !!(candidate.offsetWidth || candidate.offsetHeight || candidate.getClientRects().length);
      return /Continue/i.test(text) && visible && !candidate.disabled;
    });
    if (!button) return false;
    button.click();
    return true;
  });
}

async function extractRecoveryCodesFromPage(page) {
  const values = await page.evaluate(() => {
    const texts = [document.body?.innerText || ''];
    for (const el of document.querySelectorAll('textarea, pre, code, input, [data-clipboard-text]')) {
      texts.push(el.value || el.innerText || el.textContent || el.getAttribute('data-clipboard-text') || '');
    }
    return texts;
  });
  return extractRecoveryCodesFromText(values.join('\n'));
}

async function downloadRecoveryCodes(page) {
  const downloadButton = page.locator('button:has-text("Download"):visible').first();
  if (!await downloadButton.isVisible({ timeout: 2000 }).catch(() => false)) return [];

  const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await downloadButton.click();
  const download = await downloadPromise;
  if (!download) return [];

  const path = await download.path().catch(() => null);
  if (!path) return [];

  const content = readFileSync(path, 'utf8');
  return extractRecoveryCodesFromText(content);
}

async function summarizePage(page, label) {
  const text = (await textContent(page)).replace(/\s+/g, ' ').slice(0, 1200);
  const controls = await page.locator('button:visible, input:visible, a:visible').evaluateAll(elements =>
    elements.slice(0, 60).map(el => ({
      tag: el.tagName,
      text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 120),
      name: el.getAttribute('name') || '',
      type: el.getAttribute('type') || '',
      disabled: !!el.disabled,
      dataAction: el.getAttribute('data-action') || '',
    }))
  ).catch(() => []);
  const alerts = await page.locator('.flash, [role="alert"]').allTextContents().catch(() => []);
  console.log(`${label}_TEXT: ${sanitizeTwoFactorText(text)}`);
  console.log(`${label}_ALERTS: ${sanitizeTwoFactorText(JSON.stringify(alerts))}`);
  console.log(`${label}_CONTROLS: ${sanitizeTwoFactorText(JSON.stringify(controls))}`);
}

export async function enrollTwoFactor(page, { agent, secretsBin = resolveSecretsBin() }) {
  const enableButton = page.locator(ENABLE_2FA_BUTTON).first();
  if (await enableButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await enableButton.click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1500);
  }

  const setupKeyButton = page.locator(SETUP_KEY_BUTTON).first();
  if (!await setupKeyButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await summarizePage(page, 'TWO_FACTOR_ENROLLMENT_NOT_AVAILABLE');
    return { status: 'not_available' };
  }

  await setupKeyButton.click();
  await page.waitForTimeout(500);

  const seed = extractTwoFactorSetupKey(await textContent(page));
  if (!seed) throw new Error('Could not extract GitHub two-factor setup key.');

  execFileSync(secretsBin, ['set', `${agent}/github-totp`, '--value', seed], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(`TOTP_SECRET: stored ${agent}/github-totp`);

  const code = execFileSync(secretsBin, ['totp', `${agent}/github-totp`], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  await closeOpenDialogs(page);
  await page.waitForTimeout(500);
  await setOtpValue(page, code);
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(2500);

  let failureText = await textContent(page);
  if (/two-factor code verification failed/i.test(failureText)) {
    throw new Error('GitHub rejected the generated TOTP code.');
  }

  let recoveryCodes = await extractRecoveryCodesFromPage(page);
  if (!recoveryCodes.length) recoveryCodes = await downloadRecoveryCodes(page);

  if (!recoveryCodes.length) {
    if (await clickEnabledContinueIfPresent(page)) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(2500);
      failureText = await textContent(page);
      if (/two-factor code verification failed/i.test(failureText)) {
        throw new Error('GitHub rejected the generated TOTP code.');
      }
      recoveryCodes = await extractRecoveryCodesFromPage(page);
      if (!recoveryCodes.length) recoveryCodes = await downloadRecoveryCodes(page);
    }
  }

  if (!recoveryCodes.length) {
    await summarizePage(page, 'TWO_FACTOR_NO_RECOVERY_CODES');
    throw new Error('GitHub did not show or download recovery codes after TOTP submission.');
  }

  if (recoveryCodes.length) {
    execFileSync(secretsBin, ['set', `${agent}/github-recovery-codes`, '--value', recoveryCodes.join('\n')], {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`RECOVERY_CODES: stored ${recoveryCodes.length} code(s) at ${agent}/github-recovery-codes`);
  } else {
    console.log('RECOVERY_CODES: none found on page');
  }

  const savedButton = page.locator('button:has-text("I have saved my recovery codes"):visible').first();
  if (await savedButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(el => /I have saved my recovery codes/i.test(el.innerText || ''));
      return button && !button.disabled;
    }, null, { timeout: 10000 });
    await savedButton.click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2500);
  }

  await summarizePage(page, 'TWO_FACTOR_AFTER_FINALIZE');
  return { status: 'enrolled', recoveryCodeCount: recoveryCodes.length };
}

export default async function({ page, args }) {
  const loginId = args[0];
  const tokenName = args[1] || loginId;
  if (!loginId) {
    console.error('Usage: pass login-id as first argument');
    process.exit(1);
  }

  const username = process.env.GITHUB_USERNAME;
  const password = process.env.GITHUB_PASSWORD;
  if (!username || !password) {
    console.error('GITHUB_USERNAME and GITHUB_PASSWORD env vars required');
    process.exit(1);
  }

  await login(page, { agent: loginId, username, password });
  await page.goto(tokenCreationUrl(tokenName));
  await page.waitForLoadState('domcontentloaded');
  const result = await enrollTwoFactor(page, { agent: loginId });
  console.log(`TWO_FACTOR_RESULT:${result.status}`);
}
