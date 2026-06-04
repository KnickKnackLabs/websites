// login.mjs — Login to GitHub with device verification handling
//
// Shared module used by any script that needs an authenticated GitHub session.
// Handles the full flow: credentials → submit → device verification (via email).
//
// Usage:
//   import { login } from './login.mjs';
//   await login(page, { agent: 'x1f9', username, password });

import { pollForVerificationCode } from './email-code.mjs';
import { record } from '../record.mjs';

const OTP_SELECTOR = '#otp, input[name="otp"], input[autocomplete="one-time-code"]';

export function classifyOtpChallenge({ url = '', text = '' } = {}) {
  const haystack = `${url}\n${text}`.toLowerCase();

  if (/verify (your )?(device|email|sign[-\s]?in)|device verification|check your email|we sent[^\n]*(email|code)/.test(haystack)) {
    return 'device';
  }

  if (/two[-\s]?factor|authenticator|recovery code|security key|github mobile/.test(haystack)) {
    return 'totp';
  }

  if (url.includes('/login/device')) return 'device';
  if (url.includes('/sessions/two-factor')) return 'totp';

  return 'unknown';
}

export function normalizeTotpCode(value) {
  const code = String(value || '').trim();
  if (!/^\d{6,8}$/.test(code)) {
    throw new Error('Generated GitHub TOTP code was not a 6-8 digit value.');
  }
  return code;
}

export function resolveGitHubTotpCode(agent, { env = process.env } = {}) {
  if (env.GITHUB_TOTP_CODE) {
    return normalizeTotpCode(env.GITHUB_TOTP_CODE);
  }

  throw new Error(`GitHub two-factor authentication required for ${agent}; set GITHUB_TOTP_CODE to a current code.`);
}

async function submitOtpCode(page, otpInput, code) {
  if (await otpInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await otpInput.fill(code);
  } else {
    const textInput = page.locator('input[type="text"]:visible').first();
    await textInput.fill(code);
  }

  await page.keyboard.press('Enter').catch(() => {});

  const submitBtn = page.locator('button[type="submit"]:visible, input[type="submit"]:visible').first();
  if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await submitBtn.click();
  }
}

// Login to GitHub. Resolves when the session is fully authenticated.
// Throws on failure.
export async function login(page, { agent, username, password }) {
  console.log(`Logging in as ${username}...`);

  await page.goto('https://github.com/login');
  await page.waitForLoadState('domcontentloaded');
  await page.fill('input[name="login"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('input[type="submit"], button[type="submit"]');

  // Wait for navigation away from login form submission
  await page.waitForURL(url => !url.toString().endsWith('/session'), { timeout: 30000 }).catch(() => {
    console.error(`Warning: login navigation may have failed. Current URL: ${page.url()}`);
  });

  const postLoginUrl = page.url();
  record(`login-post-submit-${agent}.html`, await page.content());

  const otpInput = page.locator(OTP_SELECTOR).first();
  const otpVisible = await otpInput.isVisible({ timeout: 3000 }).catch(() => false);

  if (otpVisible || postLoginUrl.includes('/sessions/two-factor') || postLoginUrl.includes('/login/device')) {
    const challengeText = await page.textContent('body').catch(() => '');
    const challengeType = classifyOtpChallenge({ url: postLoginUrl, text: challengeText || '' });

    if (challengeType === 'totp') {
      console.log('Two-factor authentication required. Generating TOTP code...');
      await submitOtpCode(page, otpInput, resolveGitHubTotpCode(agent));
    } else {
      console.log('Device verification required. Polling email...');

      const code = await pollForVerificationCode(agent);
      if (!code) {
        throw new Error('Could not find verification code in email.');
      }

      console.error('Got verification code.');
      await submitOtpCode(page, otpInput, code);
    }

    // Wait for redirect past verification.
    await page.waitForURL(url => {
      const s = url.toString();
      return !s.includes('/login') && !s.includes('/sessions');
    }, { timeout: 30000 });

    record(`login-post-verify-${agent}.html`, await page.content());
  }

  const loginFormStillVisible = await page.locator('input[name="login"], input[name="password"]').first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
  if (loginFormStillVisible) {
    record(`login-failed-${agent}.html`, await page.content());
    throw new Error(`GitHub login did not complete. Current URL: ${page.url()}`);
  }

  console.log('Logged in successfully.');
}
