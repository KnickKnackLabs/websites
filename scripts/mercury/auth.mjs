// auth.mjs — Shared Mercury auth/onboarding helpers

export function extractInviteUrl(emailText) {
  const match = emailText.match(/https:\/\/app\.mercury\.com\/signup\/invite\?[^\s<>")'\]]+/);
  if (!match) return null;
  return match[0].replace(/[.,;!?]+$/, '');
}

export function isAuthenticatedMercuryUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'app.mercury.com') return false;
    return !/^\/(?:login|signup)(?:\/|$)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isMercuryAuthPage(url, pageText = '') {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'app.mercury.com' && /^\/(?:login|signup)(?:\/|$)/.test(parsed.pathname)) {
      return true;
    }
  } catch {
    // Fall back to text heuristics below.
  }

  const text = pageText.toLowerCase();
  return [
    'log in',
    'sign in',
    'activate your mercury profile',
    'set up your password',
    'two-factor authentication',
  ].some(signal => text.includes(signal));
}
