import { readSearch, requestedSearch } from './search.mjs';
import { readListing, requestedListing } from './listing.mjs';
import { readProperty } from './property.mjs';
import { RESULT_PREFIX } from './browser-command.mjs';

const READERS = { search: readSearch, listing: readListing, property: readProperty };

async function pageTargetId(context, page) {
  const session = await context.newCDPSession(page);
  try {
    const response = await session.send('Target.getTargetInfo');
    return response.targetInfo?.targetId;
  } finally {
    await session.detach();
  }
}

export async function findOwnedPage(context, targetId) {
  if (!targetId) throw new Error('Missing owned target');

  for (const page of context.pages()) {
    if (await pageTargetId(context, page) === targetId) return page;
  }

  const error = new Error('Owned Zillow tab is gone; no other tab was selected');
  error.code = 'ZILLOW_TARGET_GONE';
  throw error;
}

async function identifyChallenge({ session, challenge }) {
  const response = await session.send('Target.getTargetInfo');
  const targetId = response.targetInfo?.targetId;
  if (!targetId) throw new Error('Could not identify owned challenge tab');
  return { status: 'needs_human', targetId, challengeUrl: challenge.url };
}

export async function intervene(context, record) {
  const reader = READERS[record.operation];
  if (!reader || !Object.hasOwn(READERS, record.operation)) {
    throw new Error('Invalid intervention operation');
  }
  if (record.operation === 'search') requestedSearch(record.url);
  else requestedListing(record.url);

  const page = record.targetId
    ? await findOwnedPage(context, record.targetId)
    : undefined;
  const result = await reader(context, record.url, {
    page,
    calculator: record.calculator === true,
    unit: record.unit ?? null,
    onChallenge: identifyChallenge,
  });

  if (result.status === 'needs_human') return result;
  return { status: 'complete', result };
}

async function cancelOwnedTab(context, record) {
  try {
    const page = await findOwnedPage(context, record.targetId);
    await page.close();
  } catch (error) {
    // A completed read may have closed its tab before browser shutdown failed.
    // A missing owned tab permits cleanup; other failures must remain visible.
    if (error.code !== 'ZILLOW_TARGET_GONE') throw error;
  }
  return { status: 'cancelled' };
}

export default async function ({ context, args }) {
  if (args.length !== 2 || !['read', 'cancel'].includes(args[0])) {
    throw new Error('Invalid intervention request');
  }
  const [action, serializedRecord] = args;
  const record = JSON.parse(serializedRecord);
  const result = action === 'cancel'
    ? await cancelOwnedTab(context, record)
    : await intervene(context, record);

  console.log(RESULT_PREFIX + JSON.stringify(result));
}
