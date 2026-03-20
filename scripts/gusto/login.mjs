// login.mjs — Gusto login with optional 2FA handling
//
// Navigates to Gusto's login page, fills credentials if provided,
// and waits for authentication to complete. For interactive mode
// (no credentials), opens the login page and waits for the human.
//
// Usage:
//   shimmer browser:run --headed ./scripts/gusto/login.mjs
//   shimmer browser:run --headed ./scripts/gusto/login.mjs -- --username user@example.com --password secret

import { record } from '../record.mjs';

// --- Script entry point ---

export const site = 'gusto.com';

export default async function({ page, args }) {
  // Parse credentials from args if provided
  let username = null;
  let password = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && args[i + 1]) username = args[++i];
    if (args[i] === '--password' && args[i + 1]) password = args[++i];
  }

  await page.goto('https://app.gusto.com/login', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  record('gusto-login-page.html', await page.content());

  const automated = username && password;

  if (automated) {
    console.error(`Logging in as ${username}...`);

    // Gusto uses Keycloak — look for the email/username field
    const emailInput = page.locator('input[name="username"], input[type="email"], #username').first();
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.fill(username);

    const passwordInput = page.locator('input[name="password"], input[type="password"], #password').first();
    await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
    await passwordInput.fill(password);

    // Submit
    const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
    await submitBtn.click();

    // Wait for navigation past login
    await page.waitForURL(url => {
      const s = url.toString();
      return !s.includes('/login') && !s.includes('/realms/');
    }, { timeout: 30000 }).catch(() => {});

    record('gusto-post-login.html', await page.content());

    // Check if 2FA is required
    const currentUrl = page.url();
    if (currentUrl.includes('two-factor') || currentUrl.includes('otp') || currentUrl.includes('verify')) {
      console.error('2FA required — waiting for manual entry...');
      // Wait for redirect past 2FA (human enters the code)
      await page.waitForURL(url => {
        const s = url.toString();
        return s.includes('gusto.com/payroll_admin') || s.includes('gusto.com/home');
      }, { timeout: 120000 });
    }
  } else {
    console.error('No credentials provided — waiting for manual login...');
    console.error('Log in to Gusto in the browser window.');
    // Wait for successful authentication
    await page.waitForURL(url => {
      const s = url.toString();
      return s.includes('gusto.com/payroll_admin') || s.includes('gusto.com/home');
    }, { timeout: 300000 });
  }

  record('gusto-authenticated.html', await page.content());
  console.error('Login successful.');
}
