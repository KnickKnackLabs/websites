// sensitive-page-gate.mjs — clear GitHub sensitive-page auth gates
//
// GitHub may show a one-time post-2FA verification interstitial after a
// successful login when navigating to sensitive settings pages such as classic
// PAT create/list/rotate. This helper handles that page state with an explicit
// fresh-TOTP contract: if login just consumed a TOTP, the verification TOTP must
// differ from it.

import { normalizeTotpCode, resolveGitHubTotpCode } from './login.mjs';

const POST_2FA_VERIFY_SELECTOR = [
  'button:has-text("Verify 2FA now")',
  'input[value*="Verify 2FA"]',
].join(', ');

const POST_2FA_OTP_SELECTOR = [
  '#app_totp',
  'input[name="app_otp"]',
  '#otp',
  'input[name="otp"]',
  'input[autocomplete="one-time-code"]',
].join(', ');

const POST_2FA_SUBMIT_SELECTOR = [
  'button:has-text("Verify")',
  'button[type="submit"]',
  'input[type="submit"]',
].join(', ');

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function resolveFreshGitHubTotpCode({
  agent,
  totpResolver = resolveGitHubTotpCode,
  previousCode = null,
  timeoutMs = 65000,
  pollMs = 1000,
  sleep = defaultSleep,
} = {}) {
  const previous = previousCode ? normalizeTotpCode(previousCode) : null;
  const started = Date.now();

  while (true) {
    const candidate = normalizeTotpCode(await totpResolver(agent));
    if (!previous || candidate !== previous) {
      return candidate;
    }

    if (Date.now() - started >= timeoutMs) {
      throw new Error('Fresh GitHub TOTP code was not available before timeout; refusing to replay the login-consumed code.');
    }

    await sleep(Math.min(pollMs, Math.max(0, timeoutMs - (Date.now() - started))));
  }
}

export async function handlePost2faVerificationInterstitial(page, {
  agent,
  totpResolver = resolveGitHubTotpCode,
  loginTotpCode = null,
  freshTotpTimeoutMs = 65000,
  freshTotpPollMs = 1000,
  sleep = defaultSleep,
} = {}) {
  const verifyButton = page.locator(POST_2FA_VERIFY_SELECTOR).first();
  const visible = await verifyButton.isVisible({ timeout: 1500 }).catch(() => false);
  if (!visible) {
    return false;
  }

  const title = await page.title?.().catch(() => '') || '';
  console.error(`GitHub post-2FA verification interstitial detected${title ? ` (${title})` : ''}; verifying with a fresh TOTP.`);

  await verifyButton.click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const otpInput = page.locator(POST_2FA_OTP_SELECTOR).first();
  await otpInput.waitFor({ state: 'visible', timeout: 8000 });

  const code = await resolveFreshGitHubTotpCode({
    agent,
    totpResolver,
    previousCode: loginTotpCode,
    timeoutMs: freshTotpTimeoutMs,
    pollMs: freshTotpPollMs,
    sleep,
  });
  await otpInput.fill(code);

  const submit = page.locator(POST_2FA_SUBMIT_SELECTOR).first();
  await submit.click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return true;
}

export async function openGitHubSensitivePage(page, url, options = {}) {
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');

  const cleared = await handlePost2faVerificationInterstitial(page, options);
  if (cleared) {
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');
  }

  return { clearedPost2faVerification: cleared };
}
