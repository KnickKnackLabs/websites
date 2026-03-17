// email-code.mjs — Poll an agent's email for a verification code
//
// Used by login.mjs and potentially other flows that need email-based verification.
// Pure parsing functions are exported separately for testability.

import { execSync } from 'node:child_process';
import { record } from '../record.mjs';

// --- Pure functions (testable) ---

// Check if an email list line looks like a GitHub verification email.
export function isVerificationEmail(line) {
  const keywords = ['GitHub', 'verification', 'device', 'sign-in', 'Verify your'];
  return keywords.some(kw => line.includes(kw));
}

// Extract an email ID from a shimmer email:list table line.
// Format: | <id> | <flags> | <subject> | ...
export function parseEmailId(line) {
  const match = line.match(/\|\s*(\d+)\s*\|/);
  return match ? match[1] : null;
}

// Extract a verification code (6-8 digits) from email body text.
export function parseVerificationCode(emailText) {
  const match = emailText.match(/\b(\d{6,8})\b/);
  return match ? match[1] : null;
}

// --- Email fetching (injectable for testing) ---

const defaultFetcher = {
  listEmails(agent, count = 5) {
    return execSync(
      `GIT_AUTHOR_EMAIL="${agent}@ricon.family" shimmer email:list -n ${count}`,
      { encoding: 'utf-8', timeout: 15000 }
    );
  },
  readEmail(agent, emailId) {
    return execSync(
      `GIT_AUTHOR_EMAIL="${agent}@ricon.family" shimmer email:read ${emailId}`,
      { encoding: 'utf-8', timeout: 15000 }
    );
  },
};

// --- Main polling function ---

// Poll for a GitHub verification code in the agent's email.
// Returns the code string, or null if not found after all attempts.
// Pass a custom `fetcher` for testing.
export async function pollForVerificationCode(agent, { maxAttempts = 10, delayMs = 3000, initialDelayMs = 5000, fetcher = defaultFetcher } = {}) {
  await new Promise(r => setTimeout(r, initialDelayMs));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const listOutput = fetcher.listEmails(agent);
      record(`email-list-${agent}-${attempt}.txt`, listOutput);
      const lines = listOutput.split('\n');

      for (const line of lines) {
        if (!isVerificationEmail(line)) continue;

        const emailId = parseEmailId(line);
        if (!emailId) continue;

        const emailContent = fetcher.readEmail(agent, emailId);
        record(`email-body-${agent}-${emailId}.txt`, emailContent);
        const code = parseVerificationCode(emailContent);
        if (code) return code;
      }
    } catch (err) {
      console.log(`Email check attempt ${attempt + 1} failed: ${err.message}`);
    }

    if (attempt < maxAttempts - 1) {
      console.log(`Waiting for verification email (attempt ${attempt + 2}/${maxAttempts})...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return null;
}
