import { readSearch, requestedSearch } from './search.mjs';
import { readListing, requestedListing } from './listing.mjs';
import { RESULT_PREFIX } from './task.mjs';
import { readProperty } from './property.mjs';

export async function findOwnedPage(context, targetId) {
  if (!targetId) throw new Error('Missing owned target');
  for (const page of context.pages()) {
    const session = await context.newCDPSession(page);
    let id;
    try { id = (await session.send('Target.getTargetInfo')).targetInfo?.targetId; }
    finally { await session.detach(); }
    if (id === targetId) return page;
  }
  const error = new Error('Owned Zillow tab is gone; no other tab was selected');
  error.code = 'ZILLOW_TARGET_GONE';
  throw error;
}

export async function intervene(context, record) {
  if (!['search', 'listing', 'property'].includes(record.operation)) throw new Error('Invalid intervention operation');
  if (record.operation === 'search') requestedSearch(record.url);
  else requestedListing(record.url);
  const page = record.targetId ? await findOwnedPage(context, record.targetId) : undefined;
  const options = {
    page, calculator: record.calculator === true,
    onChallenge: async ({ session, challenge }) => {
      const targetId = (await session.send('Target.getTargetInfo')).targetInfo?.targetId;
      if (!targetId) throw new Error('Could not identify owned challenge tab');
      return { status: 'needs_human', targetId, challengeUrl: challenge.url };
    },
  };
  const reader = { search: readSearch, listing: readListing, property: readProperty }[record.operation];
  const result = await reader(context, record.url, options);
  return result.status === 'needs_human' ? result : { status: 'complete', result };
}

export default async function ({ context, args }) {
  if (args.length !== 2 || !['read', 'cancel'].includes(args[0])) throw new Error('Invalid intervention request');
  const record = JSON.parse(args[1]);
  let result;
  if (args[0] === 'cancel') {
    try {
      const page = await findOwnedPage(context, record.targetId);
      await page.close();
    } catch (error) {
      // A prior successful read/close may have removed the tab before browser
      // shutdown failed. Cancellation still permits dedicated-browser cleanup.
      if (error.code !== 'ZILLOW_TARGET_GONE') throw error;
    }
    result = { status: 'cancelled' };
  } else result = await intervene(context, record);
  console.log(RESULT_PREFIX + JSON.stringify(result));
}
