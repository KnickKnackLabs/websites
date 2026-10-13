// Raw CDP avoids browser issue #14's Playwright evaluation failure.
export function zillowUrl(value, base) {
  const url = new URL(value, base);
  const trustedHost = ['zillow.com', 'www.zillow.com'].includes(url.hostname);
  const hasCredentials = Boolean(url.username || url.password);

  if (url.protocol !== 'https:' || !trustedHost || hasCredentials || url.port) {
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
  const challenge = /captcha|press\s*(?:and|&)\s*hold|verify\s+(?:you are|you're)\s+(?:a\s+)?human|human verification|access (?:denied|to this page has been denied)/i;
  if (challenge.test(evidence)) throw new HumanVerificationRequired(snapshot);
}

export async function evaluateJSON(session, snapshotFunction, args = []) {
  const serializedArguments = args.map(value => JSON.stringify(value)).join(',');
  const response = await session.send('Runtime.evaluate', {
    expression: `(${snapshotFunction.toString()})(${serializedArguments})`,
    returnByValue: true,
  });

  const evaluationFailed = response.exceptionDetails || response.result?.type === 'error';
  if (evaluationFailed || typeof response.result?.value !== 'string') {
    throw new Error('Could not read rendered Zillow evidence through CDP');
  }

  const snapshot = JSON.parse(response.result.value);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Invalid Zillow snapshot');
  }
  requireNoChallenge(snapshot);
  return snapshot;
}

export const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// Own one tab: never navigate or close the harness's/human's existing tab.
// Only an explicit handoff callback may retain an owned challenge tab.
export async function withOwnedTab(context, read, { page: resumedPage, onChallenge } = {}) {
  const page = resumedPage ?? await context.newPage();
  let session;
  let result;
  let readFailure;

  try {
    session = await context.newCDPSession(page);
    result = await read(page, session);
  } catch (error) {
    readFailure = error;
  }

  let retainTab = false;
  const canHandOff = readFailure instanceof HumanVerificationRequired && onChallenge && session;
  if (canHandOff) {
    try {
      result = await onChallenge({ page, session, challenge: readFailure });
      retainTab = true;
      readFailure = undefined;
    } catch (error) {
      readFailure = error;
    }
  }

  // Detachment and tab closure are independent. A broken CDP connection must
  // not prevent closing the owned tab or disguise an earlier read failure.
  const cleanupFailures = [];
  if (session) {
    try {
      await session.detach();
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (!retainTab || cleanupFailures.length) {
    try {
      await page.close();
    } catch (error) {
      cleanupFailures.push(error);
    }
  }

  if (cleanupFailures.length) {
    const failures = readFailure ? [readFailure, ...cleanupFailures] : cleanupFailures;
    throw new AggregateError(failures, 'Zillow tab cleanup failed; no success result');
  }
  if (readFailure) throw readFailure;
  return result;
}
