// two-factor.mjs — GitHub 2FA enrollment helpers

import { createHmac } from 'node:crypto';
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

import { login } from './login.mjs';
import { tokenCreationUrl } from './token-create.mjs';

const SECURITY_SETTINGS_URL = 'https://github.com/settings/security';
const SETUP_KEY_BUTTON = 'button:has-text("setup key"):visible';
const START_2FA_BUTTON = [
  'button:has-text("Enable 2FA now"):visible',
  'input[value*="Enable 2FA"]:visible',
  'a:has-text("Enable 2FA"):visible',
  'button:has-text("Enable two-factor authentication"):visible',
  'a:has-text("Enable two-factor authentication"):visible',
  'button:has-text("Set up two-factor authentication"):visible',
  'a:has-text("Set up two-factor authentication"):visible',
  'a[href*="/settings/two_factor_authentication/setup"]:visible',
].join(', ');
const AUTHENTICATOR_APP_BUTTON = [
  'button:has-text("Authenticator app"):visible',
  'a:has-text("Authenticator app"):visible',
  'button:has-text("Set up using an app"):visible',
  'a:has-text("Set up using an app"):visible',
  'button:has-text("Set up with an authenticator app"):visible',
  'a:has-text("Set up with an authenticator app"):visible',
].join(', ');
const SUDO_PASSWORD_SELECTOR = 'input[name="sudo_password"]:visible, input#sudo_password:visible';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CLI_ENTRYPOINTS = new Set(['auto', 'settings', 'token']);

export function twoFactorSecurityUrl() {
  return SECURITY_SETTINGS_URL;
}

export function normalizeTwoFactorEntrypoint(value = 'auto') {
  const normalized = String(value || 'auto').trim().toLowerCase();
  if (!CLI_ENTRYPOINTS.has(normalized)) {
    throw new Error('GitHub 2FA entrypoint must be one of: auto, settings, token.');
  }
  return normalized;
}

export function classifyTwoFactorSettingsText(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return 'unknown';

  if (/two[-\s]?factor authentication\s+(?:is\s+)?not\s+enabled/i.test(value)) {
    return 'available';
  }

  if (/(disable|remove)\s+(?:two[-\s]?factor authentication|2fa)/i.test(value)
    || /two[-\s]?factor authentication\s+(?:is\s+)?enabled/i.test(value)
    || /you(?:'|’)ve enabled two[-\s]?factor authentication/i.test(value)) {
    return 'enabled';
  }

  if (/enable\s+(?:two[-\s]?factor authentication|2fa)/i.test(value)
    || /set up\s+(?:two[-\s]?factor authentication|2fa)/i.test(value)
    || /add\s+(?:two[-\s]?factor authentication|2fa)/i.test(value)) {
    return 'available';
  }

  return 'unknown';
}

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

export function decodeBase32(value) {
  const input = String(value || '').replace(/[=\s-]/g, '').toUpperCase();
  if (!input || /[^A-Z2-7]/.test(input)) {
    throw new Error('Invalid base32 value.');
  }

  let bits = 0;
  let bitCount = 0;
  const bytes = [];

  for (const char of input) {
    bits = (bits << 5) | BASE32_ALPHABET.indexOf(char);
    bitCount += 5;
    while (bitCount >= 8) {
      bytes.push((bits >>> (bitCount - 8)) & 0xff);
      bitCount -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpCode(secret, { now = Date.now(), period = 30, digits = 6 } = {}) {
  const key = decodeBase32(secret);
  const counter = Math.floor(Math.floor(now / 1000) / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  const modulo = 10 ** digits;
  return String(binary % modulo).padStart(digits, '0');
}

export function reserveEnrollmentOutput(path) {
  if (!path) return null;

  const fd = openSync(path, 'wx', 0o600);
  let closed = false;
  let wrote = false;

  return {
    write(payload) {
      if (closed) throw new Error('Enrollment output file is already closed.');
      writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`);
      closeSync(fd);
      closed = true;
      wrote = true;
    },
    discard() {
      if (!closed) {
        closeSync(fd);
        closed = true;
      }
      if (!wrote) unlinkSync(path);
    },
  };
}

export function writeEnrollmentOutput(output, payload) {
  if (!output) return;
  if (typeof output === 'string') {
    writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return;
  }
  output.write(payload);
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

async function settleAfterAction(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1200);
}

async function clickFirstVisible(page, selector, { timeout = 2000 } = {}) {
  const control = page.locator(selector).first();
  if (!await control.isVisible({ timeout }).catch(() => false)) return false;
  await control.click();
  await settleAfterAction(page);
  return true;
}

async function confirmSudoIfPresent(page, password) {
  const passwordInput = page.locator(SUDO_PASSWORD_SELECTOR).first();
  if (!await passwordInput.isVisible({ timeout: 1500 }).catch(() => false)) return false;
  if (!password) throw new Error('GitHub asked to confirm access, but GITHUB_PASSWORD is unavailable.');

  await passwordInput.fill(password);
  const submit = page.locator('button[type="submit"]:visible, input[type="submit"]:visible').first();
  if (await submit.isVisible({ timeout: 1000 }).catch(() => false)) {
    await submit.click();
  } else {
    await page.keyboard.press('Enter').catch(() => {});
  }
  await settleAfterAction(page);
  console.log('Confirmed access for GitHub security settings.');
  return true;
}

async function setupKeyVisible(page) {
  return await page.locator(SETUP_KEY_BUTTON).first().isVisible({ timeout: 1000 }).catch(() => false);
}

async function twoFactorAlreadyEnabled(page) {
  const enabledControl = page.locator([
    'button:has-text("Disable two-factor authentication"):visible',
    'a:has-text("Disable two-factor authentication"):visible',
    'button:has-text("Disable 2FA"):visible',
    'a:has-text("Disable 2FA"):visible',
  ].join(', ')).first();
  if (await enabledControl.isVisible({ timeout: 1000 }).catch(() => false)) return true;

  return classifyTwoFactorSettingsText(await textContent(page)) === 'enabled';
}

async function advanceTowardAuthenticatorSetup(page, { password = '' } = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await setupKeyVisible(page)) return true;
    if (await confirmSudoIfPresent(page, password)) continue;
    if (await clickFirstVisible(page, START_2FA_BUTTON)) continue;
    if (await clickFirstVisible(page, AUTHENTICATOR_APP_BUTTON)) continue;
    return false;
  }
  return await setupKeyVisible(page);
}

async function openSettingsEnrollment(page, { password = '' } = {}) {
  console.log('Opening GitHub security settings for proactive 2FA enrollment...');
  await page.goto(SECURITY_SETTINGS_URL);
  await settleAfterAction(page);
  await confirmSudoIfPresent(page, password);

  if (await twoFactorAlreadyEnabled(page)) return { status: 'already_enabled' };
  if (await advanceTowardAuthenticatorSetup(page, { password })) return { status: 'ready' };

  await summarizePage(page, 'TWO_FACTOR_SETTINGS_ENTRYPOINT_NOT_AVAILABLE');
  return { status: 'not_available' };
}

async function openTokenGateEnrollment(page, { tokenName, password = '' } = {}) {
  console.log('Opening classic token creation page as 2FA enrollment fallback...');
  await page.goto(tokenCreationUrl(tokenName));
  await settleAfterAction(page);
  await confirmSudoIfPresent(page, password);

  if (await advanceTowardAuthenticatorSetup(page, { password })) return { status: 'ready' };
  await summarizePage(page, 'TWO_FACTOR_TOKEN_GATE_NOT_AVAILABLE');
  return { status: 'not_available' };
}

async function prepareEnrollmentPage(page, { entrypoint, tokenName, password = '' } = {}) {
  if (entrypoint === 'current') {
    if (await advanceTowardAuthenticatorSetup(page, { password })) return { status: 'ready' };
    return { status: 'not_available' };
  }

  const normalized = normalizeTwoFactorEntrypoint(entrypoint);
  const attempts = normalized === 'auto' ? ['settings', 'token'] : [normalized];

  for (const attempt of attempts) {
    const result = attempt === 'settings'
      ? await openSettingsEnrollment(page, { password })
      : await openTokenGateEnrollment(page, { tokenName, password });
    if (result.status === 'ready' || result.status === 'already_enabled') return result;
  }

  return { status: 'not_available' };
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

export async function enrollTwoFactor(page, {
  outputPath = '',
  output = null,
  tokenName = 'github-2fa-enrollment',
  entrypoint = 'current',
  password = '',
} = {}) {
  const enrollmentOutput = output || (outputPath ? reserveEnrollmentOutput(outputPath) : null);
  const ownsOutput = !output && !!enrollmentOutput;

  try {
    const prepared = await prepareEnrollmentPage(page, { entrypoint, tokenName, password });
    if (prepared.status === 'already_enabled') {
      const result = { status: 'already_enabled' };
      writeEnrollmentOutput(enrollmentOutput, result);
      return result;
    }
    if (prepared.status !== 'ready') {
      await summarizePage(page, 'TWO_FACTOR_ENROLLMENT_NOT_AVAILABLE');
      const result = { status: 'not_available' };
      writeEnrollmentOutput(enrollmentOutput, result);
      return result;
    }

    const setupKeyButton = page.locator(SETUP_KEY_BUTTON).first();
    if (!await setupKeyButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await summarizePage(page, 'TWO_FACTOR_ENROLLMENT_NOT_AVAILABLE');
      const result = { status: 'not_available' };
      writeEnrollmentOutput(enrollmentOutput, result);
      return result;
    }

    await setupKeyButton.click();
    await page.waitForTimeout(500);

    const seed = extractTwoFactorSetupKey(await textContent(page));
    if (!seed) throw new Error('Could not extract GitHub two-factor setup key.');
    console.log('TOTP_SECRET: captured');

    const code = generateTotpCode(seed);

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

    console.log(`RECOVERY_CODES: captured ${recoveryCodes.length} code(s)`);

    const result = { status: 'enrolled', totp_seed: seed, recovery_codes: recoveryCodes };
    writeEnrollmentOutput(enrollmentOutput, result);

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
    return result;
  } catch (error) {
    if (ownsOutput) enrollmentOutput.discard();
    throw error;
  }
}

export default async function({ page, args }) {
  const loginId = args[0];
  const tokenName = args[1] || loginId;
  const outputPath = args[2] || process.env.WEBSITES_GITHUB_2FA_OUT || '';
  const entrypoint = normalizeTwoFactorEntrypoint(args[3] || process.env.WEBSITES_GITHUB_2FA_ENTRYPOINT || 'auto');
  if (!loginId) {
    console.error('Usage: pass login-id as first argument');
    process.exit(1);
  }
  if (!outputPath) {
    console.error('Output path required for 2FA enrollment material. Pass --out <path>.');
    process.exit(1);
  }

  const username = process.env.GITHUB_USERNAME;
  const password = process.env.GITHUB_PASSWORD;
  if (!username || !password) {
    console.error('GITHUB_USERNAME and GITHUB_PASSWORD env vars required');
    process.exit(1);
  }

  const output = reserveEnrollmentOutput(outputPath);
  try {
    await login(page, { agent: loginId, username, password });
    const result = await enrollTwoFactor(page, {
      output,
      tokenName,
      entrypoint,
      password,
    });
    console.log(`TWO_FACTOR_RESULT:${result.status}`);
  } catch (error) {
    output?.discard();
    throw error;
  }
}
