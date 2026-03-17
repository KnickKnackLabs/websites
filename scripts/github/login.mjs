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
  await page.waitForURL(url => !url.toString().endsWith('/session'), { timeout: 30000 }).catch(() => {});

  const postLoginUrl = page.url();
  record(`login-post-submit-${agent}.html`, await page.content());

  // Check for device verification
  if (postLoginUrl.includes('/sessions/two-factor') || postLoginUrl.includes('/login/device')) {
    console.log('Device verification required. Polling email...');

    const code = await pollForVerificationCode(agent);
    if (!code) {
      throw new Error('Could not find verification code in email.');
    }

    console.log(`Found verification code: ${code}`);

    // GitHub device verification: look for the OTP input
    const otpInput = page.locator('#otp, input[name="otp"], input[autocomplete="one-time-code"]').first();
    if (await otpInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await otpInput.fill(code);
    } else {
      const textInput = page.locator('input[type="text"]:visible').first();
      await textInput.fill(code);
    }

    // Submit
    const submitBtn = page.locator('button[type="submit"]:visible').first();
    if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await submitBtn.click();
    }

    // Wait for redirect past verification
    await page.waitForURL(url => {
      const s = url.toString();
      return !s.includes('/login') && !s.includes('/sessions');
    }, { timeout: 30000 });

    record(`login-post-verify-${agent}.html`, await page.content());
  }

  console.log('Logged in successfully.');
}
