// Own one tab; never navigate or close the harness's/human's existing tab.
// Raw CDP avoids browser issue #14's Playwright evaluation failure.
export function zillowUrl(value, base) {
  const url = new URL(value, base);
  if (url.protocol !== 'https:' || !['zillow.com', 'www.zillow.com'].includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Expected an HTTPS Zillow URL');
  }
  return url;
}

export class HumanVerificationRequired extends Error {
  constructor(snapshot) {
    super('Zillow challenge encountered; stopped without bypassing it');
    this.name = 'HumanVerificationRequired';
    this.url = snapshot.url ?? null;
  }
}

export function requireNoChallenge(snapshot) {
  const evidence = `${snapshot.title ?? ''}\n${snapshot.text ?? ''}`;
  if (/captcha|press\s*(?:and|&)\s*hold|verify\s+(?:you are|you're)\s+(?:a\s+)?human|human verification|access (?:denied|to this page has been denied)/i.test(evidence)) {
    throw new HumanVerificationRequired(snapshot);
  }
}

export async function evaluateJSON(session, snapshotFunction) {
  const response = await session.send('Runtime.evaluate', {
    expression: `(${snapshotFunction.toString()})()`, returnByValue: true,
  });
  if (response.exceptionDetails || response.result?.type === 'error' || typeof response.result?.value !== 'string') {
    throw new Error('Could not read rendered Zillow evidence through CDP');
  }
  const snapshot = JSON.parse(response.result.value);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Invalid Zillow snapshot');
  requireNoChallenge(snapshot);
  return snapshot;
}

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Only an explicit handoff callback may retain an owned challenge tab.
// Ordinary reads keep the original fail-and-clean-up behavior.
export async function withOwnedTab(context, read, { page: resumedPage, onChallenge } = {}) {
  const page = resumedPage ?? await context.newPage();
  let session;
  let value;
  let failure;
  try {
    session = await context.newCDPSession(page);
    value = await read(page, session);
  } catch (error) {
    failure = error;
  }
  let retained = false;
  if (failure instanceof HumanVerificationRequired && onChallenge && session) {
    try {
      value = await onChallenge({ page, session, challenge: failure });
      retained = true;
      failure = undefined;
    } catch (error) { failure = error; }
  }
  const cleanup = [];
  try { if (session) await session.detach(); } catch (error) { cleanup.push(error); }
  if (!retained || cleanup.length) {
    try { await page.close(); } catch (error) { cleanup.push(error); }
  }
  if (cleanup.length) throw new AggregateError(failure ? [failure, ...cleanup] : cleanup, 'Zillow tab cleanup failed; no success result');
  if (failure) throw failure;
  return value;
}
