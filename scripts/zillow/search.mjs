import { zillowUrl, evaluateJSON, withOwnedTab, delay } from './browser.mjs';
import { RESULT_PREFIX } from './browser-command.mjs';

export const MAX_PAGES = 20;
const QUERY_SCOPE_FIELDS = ['regionSelection', 'mapBounds', 'filterState'];
const RENDER_ATTEMPTS = 15;
const RENDER_POLL_DELAY_MS = 1000;
const BETWEEN_PAGES_DELAY_MS = 1500;
const NAVIGATION_TIMEOUT_MS = 60000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function requestedSearch(value) {
  const url = zillowUrl(value);
  const encodedState = url.searchParams.get('searchQueryState');
  if (!encodedState) throw new Error('URL must include searchQueryState');

  const query = JSON.parse(encodedState);
  const explicitScope = isObject(query)
    && isObject(query.filterState)
    && (query.regionSelection || query.mapBounds);
  if (!explicitScope) {
    throw new Error('Search requires explicit filters and regionSelection or mapBounds');
  }
  return { url: url.href, query };
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!isObject(value)) return value;

  const sortedEntries = Object.keys(value)
    .sort()
    .map(key => [key, sortObjectKeys(value[key])]);
  return Object.fromEntries(sortedEntries);
}

function comparableScopeField(field, value) {
  const normalized = structuredClone(value);
  // Zillow inserts null for unspecified numeric bounds; no other differences
  // are relaxed, so a stale or broadened query cannot silently pass.
  if (field === 'filterState') {
    for (const name of ['monthlyPayment', 'beds', 'baths']) {
      for (const bound of ['min', 'max']) {
        if (normalized?.[name]?.[bound] === null) delete normalized[name][bound];
      }
    }
  }
  return JSON.stringify(sortObjectKeys(normalized));
}

export function requireRequestedQuery(rendered, requested) {
  for (const field of QUERY_SCOPE_FIELDS) {
    const actual = comparableScopeField(field, rendered?.[field]);
    const expected = comparableScopeField(field, requested[field]);
    if (actual !== expected) {
      throw new Error(`Rendered search differs from requested search (${field})`);
    }
  }
}

// Serialized into the browser realm: no imported helpers or free variables.
export function renderedSearchSnapshot() {
  const element = document.querySelector('#__NEXT_DATA__');
  const hydration = element ? JSON.parse(element.textContent) : null;
  const search = hydration?.props?.pageProps?.searchPageState;
  return JSON.stringify({
    url: location.href,
    title: document.title,
    text: document.body.innerText,
    query: search?.queryState,
    rendered: search?.serverRenderTimestamp,
    cat1: search?.cat1,
  });
}

export function pageEvidence(snapshot, pageNumber) {
  zillowUrl(snapshot.url);
  const rows = snapshot.cat1?.searchResults?.listResults;
  const summary = snapshot.cat1?.searchList;
  if (!Array.isArray(rows)) throw new Error('Missing rendered listing rows');

  const emptySearch = summary?.totalPages === 0 && rows.length === 0;
  const totalPages = emptySearch ? 1 : summary?.totalPages;
  if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > MAX_PAGES) {
    throw new Error('Unsupported page count; completeness not established');
  }
  const renderedPage = snapshot.query?.pagination?.currentPage ?? 1;
  if (renderedPage !== pageNumber) throw new Error('Wrong rendered search page');

  const advertisedCount = summary.totalResultCount;
  if (!Number.isSafeInteger(advertisedCount) || advertisedCount < 0) {
    throw new Error('Invalid advertised result count');
  }
  return {
    number: pageNumber,
    url: snapshot.url,
    rendered: snapshot.rendered ?? null,
    totalPages,
    advertisedCount,
    rows,
  };
}

function listingFromRow(row) {
  const stringIdentity = typeof row?.zpid === 'string' && row.zpid.trim().length > 0;
  const numericIdentity = Number.isSafeInteger(row?.zpid) && row.zpid > 0;
  if (!stringIdentity && !numericIdentity) throw new Error('Listing lacks a Zillow identity');

  if (typeof row.detailUrl !== 'string' || !row.detailUrl.trim()) {
    throw new Error('Listing lacks a source URL');
  }
  const url = zillowUrl(row.detailUrl, 'https://www.zillow.com');
  if (url.pathname === '/') throw new Error('Listing lacks a detail URL');

  const availabilityCount = row.availabilityCount === undefined ? 1 : row.availabilityCount;
  if (!Number.isSafeInteger(availabilityCount) || availabilityCount < 1) {
    throw new Error('Invalid listing availability count');
  }
  return {
    id: String(row.zpid),
    url: url.href,
    isBuilding: row.isBuilding ?? null,
    availabilityCount,
    source: row,
  };
}

function requireCompletePages(pages) {
  const orderedAndComplete = pages.length > 0 && pages.every((page, index) => (
    page.number === index + 1 && page.totalPages === pages.length
  ));
  if (!orderedAndComplete) throw new Error('Result pages are incomplete');
}

export function completeSearch(pages) {
  requireCompletePages(pages);
  const seenIds = new Set();
  const listings = [];
  let availableUnits = 0;

  for (const page of pages) {
    for (const row of page.rows) {
      const listing = listingFromRow(row);
      if (seenIds.has(listing.id)) {
        throw new Error('Repeated listing across pages; completeness needs review');
      }
      seenIds.add(listing.id);
      availableUnits += listing.availabilityCount;
      if (!Number.isSafeInteger(availableUnits)) {
        throw new Error('Invalid total availability count');
      }
      listings.push(listing);
    }
  }

  // Building rows can represent several units. Count those units, not rows,
  // while requiring the same advertised total on every rendered page.
  if (pages.some(page => page.advertisedCount !== availableUnits)) {
    throw new Error('Listing rows do not account for the advertised count; completeness not established');
  }
  const pageSummaries = pages.map(({ rows, ...summary }) => summary);
  return {
    complete: true,
    advertisedCount: availableUnits,
    rowCount: listings.length,
    pages: pageSummaries,
    listings,
  };
}

export async function waitForSearch(session, { sleep = delay, attempts = RENDER_ATTEMPTS } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const snapshot = await evaluateJSON(session, renderedSearchSnapshot);
    const visibleSearch = /rentals available|rental listings|no matching results/i.test(snapshot.text ?? '');
    if (snapshot.cat1 && visibleSearch) return snapshot;
    if (attempt + 1 < attempts) await sleep(RENDER_POLL_DELAY_MS);
  }
  throw new Error('Search did not render usable results');
}

function searchPageUrl(url, query, pageNumber) {
  const next = new URL(url);
  const pageQuery = { ...query, pagination: { currentPage: pageNumber } };
  next.searchParams.set('searchQueryState', JSON.stringify(pageQuery));
  return next.href;
}

export async function readSearch(context, value, { sleep = delay, page: resumedPage, onChallenge } = {}) {
  const { url, query } = requestedSearch(value);
  return withOwnedTab(context, async (page, session) => {
    // Confirm the parked challenge was solved, then restart at page one.
    // Partial results from the interrupted read never imply completeness.
    if (resumedPage) await evaluateJSON(session, renderedSearchSnapshot);

    const pages = [];
    let totalPages;
    for (let pageNumber = 1; pageNumber <= (totalPages ?? 1); pageNumber++) {
      await page.goto(searchPageUrl(url, query, pageNumber), {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      const snapshot = await waitForSearch(session, { sleep });
      requireRequestedQuery(snapshot.query, query);
      const evidence = pageEvidence(snapshot, pageNumber);
      if (totalPages !== undefined && totalPages !== evidence.totalPages) {
        throw new Error('Page count changed during search');
      }
      totalPages = evidence.totalPages;
      pages.push(evidence);
      if (pageNumber < totalPages) await sleep(BETWEEN_PAGES_DELAY_MS);
    }
    return {
      checked: new Date().toISOString(),
      requestedUrl: url,
      query,
      ...completeSearch(pages),
    };
  }, { page: resumedPage, onChallenge });
}

export default async function ({ context, args }) {
  if (args.length !== 1) throw new Error('Provide exactly one Zillow search URL');
  const result = await readSearch(context, args[0]);
  console.log(RESULT_PREFIX + JSON.stringify(result));
}
