import { zillowUrl, evaluateJSON, withOwnedTab, delay } from './browser.mjs';
import { RESULT_PREFIX } from './task.mjs';

export const MAX_PAGES = 20;
const QUERY_KEYS = ['regionSelection', 'mapBounds', 'filterState'];

export function requestedSearch(value) {
  const url = zillowUrl(value);
  const state = url.searchParams.get('searchQueryState');
  if (!state) throw new Error('URL must include searchQueryState');
  const query = JSON.parse(state);
  if (!query || typeof query !== 'object' || Array.isArray(query) || !query.filterState || typeof query.filterState !== 'object' || Array.isArray(query.filterState) || (!query.regionSelection && !query.mapBounds)) {
    throw new Error('Search requires explicit filters and regionSelection or mapBounds');
  }
  return { url: url.href, query };
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}

function comparable(key, value) {
  const copy = structuredClone(value);
  // Zillow inserts null for unspecified numeric bounds; nothing else is relaxed.
  if (key === 'filterState') {
    for (const name of ['monthlyPayment', 'beds', 'baths']) {
      for (const bound of ['min', 'max']) if (copy?.[name]?.[bound] === null) delete copy[name][bound];
    }
  }
  return JSON.stringify(sorted(copy));
}

export function requireRequestedQuery(rendered, requested) {
  for (const key of QUERY_KEYS) {
    if (comparable(key, rendered?.[key]) !== comparable(key, requested[key])) throw new Error(`Rendered search differs from requested search (${key})`);
  }
}

// Browser-realm function: no imported helpers or free variables.
export function renderedSearchSnapshot() {
  const element = document.querySelector('#__NEXT_DATA__');
  const hydration = element ? JSON.parse(element.textContent) : null;
  const search = hydration?.props?.pageProps?.searchPageState;
  return JSON.stringify({ url: location.href, title: document.title, text: document.body.innerText, query: search?.queryState, rendered: search?.serverRenderTimestamp, cat1: search?.cat1 });
}

export function pageEvidence(snapshot, number) {
  zillowUrl(snapshot.url);
  const rows = snapshot.cat1?.searchResults?.listResults;
  const list = snapshot.cat1?.searchList;
  if (!Array.isArray(rows)) throw new Error('Missing rendered listing rows');
  const totalPages = list?.totalPages === 0 && rows.length === 0 ? 1 : list?.totalPages;
  if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > MAX_PAGES) throw new Error('Unsupported page count; completeness not established');
  if ((snapshot.query?.pagination?.currentPage ?? 1) !== number) throw new Error('Wrong rendered search page');
  if (!Number.isSafeInteger(list.totalResultCount) || list.totalResultCount < 0) throw new Error('Invalid advertised result count');
  return { number, url: snapshot.url, rendered: snapshot.rendered ?? null, totalPages, advertisedCount: list.totalResultCount, rows };
}

export function completeSearch(pages) {
  if (!pages.length || pages.some((page, index) => page.number !== index + 1 || page.totalPages !== pages.length)) throw new Error('Result pages are incomplete');
  const ids = new Set();
  const listings = [];
  let units = 0;
  for (const page of pages) {
    for (const row of page.rows) {
      if (!row || !['string', 'number'].includes(typeof row.zpid) || !String(row.zpid).trim() || (typeof row.zpid === 'number' && (!Number.isSafeInteger(row.zpid) || row.zpid <= 0))) throw new Error('Listing lacks a Zillow identity');
      const id = String(row.zpid);
      if (ids.has(id)) throw new Error('Repeated listing across pages; completeness needs review');
      ids.add(id);
      if (typeof row.detailUrl !== 'string' || !row.detailUrl.trim()) throw new Error('Listing lacks a source URL');
      const url = zillowUrl(row.detailUrl, 'https://www.zillow.com');
      if (url.pathname === '/') throw new Error('Listing lacks a detail URL');
      const availabilityCount = row.availabilityCount === undefined ? 1 : row.availabilityCount;
      if (!Number.isSafeInteger(availabilityCount) || availabilityCount < 1) throw new Error('Invalid listing availability count');
      units += availabilityCount;
      if (!Number.isSafeInteger(units)) throw new Error('Invalid total availability count');
      listings.push({ id, url: url.href, isBuilding: row.isBuilding ?? null, availabilityCount, source: row });
    }
  }
  if (pages.some(page => page.advertisedCount !== units)) throw new Error('Listing rows do not account for the advertised count; completeness not established');
  return {
    complete: true, advertisedCount: units, rowCount: listings.length,
    pages: pages.map(({ rows, ...evidence }) => evidence), listings,
  };
}

export async function waitForSearch(session, { sleep = delay, attempts = 15 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const snapshot = await evaluateJSON(session, renderedSearchSnapshot);
    if (snapshot.cat1 && /rentals available|rental listings|no matching results/i.test(snapshot.text ?? '')) return snapshot;
    if (attempt + 1 < attempts) await sleep(1000);
  }
  throw new Error('Search did not render usable results');
}

export async function readSearch(context, value, { sleep = delay, page: resumedPage, onChallenge } = {}) {
  const { url, query } = requestedSearch(value);
  return withOwnedTab(context, async (page, session) => {
    // Confirm the human solved the parked challenge before restarting pagination.
    // Restart from page one so partial results are never reused as a complete search.
    if (resumedPage) await evaluateJSON(session, renderedSearchSnapshot);
    const pages = [];
    let totalPages;
    for (let number = 1; number <= (totalPages ?? 1); number++) {
      const next = new URL(url);
      next.searchParams.set('searchQueryState', JSON.stringify({ ...query, pagination: { currentPage: number } }));
      await page.goto(next.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const snapshot = await waitForSearch(session, { sleep });
      requireRequestedQuery(snapshot.query, query);
      const evidence = pageEvidence(snapshot, number);
      if (totalPages !== undefined && totalPages !== evidence.totalPages) throw new Error('Page count changed during search');
      totalPages = evidence.totalPages;
      pages.push(evidence);
      if (number < totalPages) await sleep(1500);
    }
    return { checked: new Date().toISOString(), requestedUrl: url, query, ...completeSearch(pages) };
  }, { page: resumedPage, onChallenge });
}

export default async function ({ context, args }) {
  if (args.length !== 1) throw new Error('Provide exactly one Zillow search URL');
  const result = await readSearch(context, args[0]);
  console.log(RESULT_PREFIX + JSON.stringify(result));
}
