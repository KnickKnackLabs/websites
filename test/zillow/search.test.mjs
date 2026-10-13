import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestedSearch,
  requireRequestedQuery,
  pageEvidence,
  completeSearch,
  readSearch,
  waitForSearch,
} from '../../scripts/zillow/search.mjs';

const query = {
  regionSelection: [{ regionId: 123, regionType: 6 }],
  filterState: {
    isForRent: { value: true },
    monthlyPayment: { max: 2000 },
    beds: { min: 2 },
  },
};
const url = 'https://www.zillow.com/homes/for_rent/?searchQueryState='
  + encodeURIComponent(JSON.stringify(query));

function listingRow(id, { availableUnits } = {}) {
  const row = { zpid: id, detailUrl: `/homedetails/example/${id}_zpid/` };
  if (availableUnits !== undefined) {
    row.availabilityCount = availableUnits;
    row.isBuilding = true;
  }
  return row;
}

function renderedPage({
  pageNumber = 1,
  totalPages = 1,
  advertisedCount = 1,
  rows = [listingRow('1')],
  renderedQuery = query,
} = {}) {
  return {
    url,
    text: 'Rental listings',
    rendered: 'date',
    query: { ...renderedQuery, pagination: { currentPage: pageNumber } },
    cat1: {
      searchList: { totalPages, totalResultCount: advertisedCount },
      searchResults: { listResults: rows },
    },
  };
}

function verifiedPage(options = {}) {
  const snapshot = renderedPage(options);
  return pageEvidence(snapshot, options.pageNumber ?? 1);
}

// Stub only the CDP transport and ownership calls. Snapshot parsing and all
// scope/count decisions run through production code, not a fake DOM.
function browserTransport(snapshots, { detachFails = false } = {}) {
  const events = [];
  let nextSnapshot = 0;
  const page = {
    async goto(url, options) { events.push({ action: 'goto', url, options }); },
    async close() { events.push({ action: 'close' }); },
  };
  const session = {
    async send() {
      const index = Math.min(nextSnapshot++, snapshots.length - 1);
      return { result: { value: JSON.stringify(snapshots[index]) } };
    },
    async detach() {
      events.push({ action: 'detach' });
      if (detachFails) throw new Error('detach failed');
    },
  };
  const context = {
    async newPage() { return page; },
    async newCDPSession() { return session; },
  };
  return { context, session, events };
}

function assertOwnedTabClosed(events) {
  assert.deepEqual(events.slice(-2), [{ action: 'detach' }, { action: 'close' }]);
}

const noWait = async () => {};

test('search accepts a Zillow URL with explicit filters and location', () => {
  assert.deepEqual(requestedSearch(url).query, query);
});

const invalidUrls = {
  'foreign host': 'https://evil.test/?searchQueryState={}',
  'missing query': 'https://www.zillow.com',
  'null query': 'https://www.zillow.com/?searchQueryState=null',
  'missing filters and location': 'https://www.zillow.com/?searchQueryState={}',
};
for (const [name, value] of Object.entries(invalidUrls)) {
  test(`search rejects ${name}`, () => {
    assert.throws(() => requestedSearch(value));
  });
}

test('scope comparison ignores key order and unspecified null numeric bounds', () => {
  const rendered = {
    filterState: {
      beds: { max: null, min: 2 },
      monthlyPayment: { min: null, max: 2000 },
      isForRent: { value: true },
    },
    regionSelection: query.regionSelection,
  };
  assert.doesNotThrow(() => requireRequestedQuery(rendered, query));
});

const changedScopes = {
  'another region': { ...query, regionSelection: [{ regionId: 999, regionType: 6 }] },
  'higher rent ceiling': {
    ...query,
    filterState: { ...query.filterState, monthlyPayment: { max: 3000 } },
  },
  'additional map bounds': { ...query, mapBounds: { north: 50 } },
  'new null pet filter': {
    ...query,
    filterState: { ...query.filterState, petsAllowed: { value: null } },
  },
};
for (const [name, changed] of Object.entries(changedScopes)) {
  test(`scope comparison rejects ${name}`, () => {
    assert.throws(() => requireRequestedQuery(changed, query), /differs/);
  });
}

test('page evidence represents an empty search as one verified page', () => {
  const empty = verifiedPage({ totalPages: 0, advertisedCount: 0, rows: [] });
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.advertisedCount, 0);
  assert.equal(completeSearch([empty]).rowCount, 0);
});

const invalidSnapshots = {
  'wrong rendered page': renderedPage({ pageNumber: 2 }),
  'page count over the cap': renderedPage({ totalPages: 21 }),
  'missing page count': renderedPage({ totalPages: null }),
  'negative advertised count': renderedPage({ advertisedCount: -1 }),
  'missing listing rows': { ...renderedPage(), cat1: {} },
};
for (const [name, snapshot] of Object.entries(invalidSnapshots)) {
  test(`page evidence rejects ${name}`, () => {
    assert.throws(() => pageEvidence(snapshot, 1));
  });
}

test('completeness counts building units without inventing individual unit rows', () => {
  const building = listingRow('building-opaque', { availableUnits: 3 });
  const pages = [
    verifiedPage({ pageNumber: 1, totalPages: 2, advertisedCount: 4, rows: [building] }),
    verifiedPage({ pageNumber: 2, totalPages: 2, advertisedCount: 4, rows: [listingRow('2')] }),
  ];
  const result = completeSearch(pages);

  assert.equal(result.complete, true);
  assert.equal(result.advertisedCount, 4);
  assert.equal(result.rowCount, 2);
  assert.equal(result.listings[0].id, 'building-opaque');
  assert.equal(result.listings[0].isBuilding, true);
  assert.equal(result.pages[0].rows, undefined);
});

const onePage = verifiedPage();
const incompleteResults = {
  'no pages': [],
  'missing first page': [{ ...onePage, number: 2 }],
  'missing final page': [{ ...onePage, totalPages: 2 }],
  'unaccounted advertised result': [{ ...onePage, advertisedCount: 2 }],
  'duplicate IDs': [{ ...onePage, rows: [listingRow('1'), listingRow('1')], advertisedCount: 2 }],
};
for (const [name, pages] of Object.entries(incompleteResults)) {
  test(`completeness rejects ${name}`, () => {
    assert.throws(() => completeSearch(pages));
  });
}

const invalidRows = {
  'zero available units': listingRow('1', { availableUnits: 0 }),
  'fractional available units': listingRow('1', { availableUnits: 1.5 }),
  'empty identity': { ...listingRow('1'), zpid: '' },
  'unsafe numeric identity': { ...listingRow('1'), zpid: Number.MAX_SAFE_INTEGER + 1 },
  'foreign detail URL': { ...listingRow('1'), detailUrl: 'https://evil.test/a' },
  'homepage instead of detail URL': { ...listingRow('1'), detailUrl: '/' },
};
for (const [name, row] of Object.entries(invalidRows)) {
  test(`completeness rejects a listing with ${name}`, () => {
    assert.throws(() => completeSearch([{ ...onePage, rows: [row] }]));
  });
}

test('reader waits for hydration, navigates every page, and closes its owned tab', async () => {
  const browser = browserTransport([
    { url, text: 'loading' },
    renderedPage({ totalPages: 2, advertisedCount: 4, rows: [listingRow('building', { availableUnits: 3 })] }),
    renderedPage({ pageNumber: 2, totalPages: 2, advertisedCount: 4, rows: [listingRow('2')] }),
  ]);
  const waits = [];
  const result = await readSearch(browser.context, url, {
    sleep: async milliseconds => waits.push(milliseconds),
  });

  assert.equal(result.advertisedCount, 4);
  assert.deepEqual(waits, [1000, 1500]);
  assertOwnedTabClosed(browser.events);
  const navigatedPages = browser.events
    .filter(event => event.action === 'goto')
    .map(event => requestedSearch(event.url).query.pagination.currentPage);
  assert.deepEqual(navigatedPages, [1, 2]);
});

const failingReads = {
  'human verification': [ { ...renderedPage(), text: 'CAPTCHA Rental listings' } ],
  'stale scope': [ renderedPage({ renderedQuery: { ...query, filterState: {} } }) ],
  'changed total pages': [
    renderedPage({ totalPages: 2, advertisedCount: 2 }),
    renderedPage({ pageNumber: 2, totalPages: 1, advertisedCount: 2, rows: [listingRow('2')] }),
  ],
  'repeated first page': [
    renderedPage({ totalPages: 2, advertisedCount: 2 }),
    renderedPage({ totalPages: 2, advertisedCount: 2, rows: [listingRow('2')] }),
  ],
  'changed advertised count': [
    renderedPage({ totalPages: 2, advertisedCount: 2 }),
    renderedPage({ pageNumber: 2, totalPages: 2, advertisedCount: 3, rows: [listingRow('2')] }),
  ],
};
for (const [name, snapshots] of Object.entries(failingReads)) {
  test(`reader rejects ${name} and closes its owned tab`, async () => {
    const browser = browserTransport(snapshots);
    await assert.rejects(readSearch(browser.context, url, { sleep: noWait }));
    assertOwnedTabClosed(browser.events);
  });
}

test('reader does not return success when CDP cleanup fails', async () => {
  const browser = browserTransport([renderedPage()], { detachFails: true });
  await assert.rejects(readSearch(browser.context, url, { sleep: noWait }), /cleanup failed/);
  assertOwnedTabClosed(browser.events);
});

test('render polling stops after its attempt budget', async () => {
  const browser = browserTransport([{ url, text: 'loading' }]);
  await assert.rejects(waitForSearch(browser.session, { attempts: 2, sleep: noWait }), /did not render/);
});

test('a CDP exception is not a successful empty search', async () => {
  const session = { async send() { return { exceptionDetails: {} }; } };
  await assert.rejects(waitForSearch(session), /CDP/);
});
