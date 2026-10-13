import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedSearch, requireRequestedQuery, pageEvidence, completeSearch, readSearch, waitForSearch } from '../../scripts/zillow/search.mjs';

const query = { regionSelection: [{ regionId: 123, regionType: 6 }], filterState: { isForRent: { value: true }, monthlyPayment: { max: 2000 }, beds: { min: 2 } } };
const url = 'https://www.zillow.com/homes/for_rent/?searchQueryState=' + encodeURIComponent(JSON.stringify(query));
const row = (id, count) => ({ zpid: id, detailUrl: `/homedetails/example/${id}_zpid/`, ...(count === undefined ? {} : { availabilityCount: count, isBuilding: true }) });
const snapshot = (number = 1, pages = 1, count = 1, rows = [row('1')]) => ({ url, text: 'Rental listings', rendered: 'date', query: { ...query, pagination: { currentPage: number } }, cat1: { searchList: { totalPages: pages, totalResultCount: count }, searchResults: { listResults: rows } } });

test('search requires Zillow URL, explicit query and requested scope', () => {
  assert.deepEqual(requestedSearch(url).query, query);
  for (const value of ['https://evil.test/?searchQueryState={}', 'https://www.zillow.com', 'https://www.zillow.com/?searchQueryState=null', 'https://www.zillow.com/?searchQueryState={}']) assert.throws(() => requestedSearch(value));
});

test('query comparison tolerates key order and unspecified null numeric bounds only', () => {
  const rendered = { filterState: { beds: { max: null, min: 2 }, monthlyPayment: { min: null, max: 2000 }, isForRent: { value: true } }, regionSelection: query.regionSelection };
  assert.doesNotThrow(() => requireRequestedQuery(rendered, query));
  for (const changed of [{ ...rendered, regionSelection: [{ regionId: 999, regionType: 6 }] }, { ...rendered, filterState: { ...rendered.filterState, monthlyPayment: { max: 3000 } } }, { ...rendered, mapBounds: { north: 50 } }, { ...rendered, filterState: { ...rendered.filterState, petsAllowed: { value: null } } }]) assert.throws(() => requireRequestedQuery(changed, query), /differs/);
});

test('page evidence validates pagination, result count and page cap', () => {
  assert.equal(pageEvidence(snapshot(), 1).advertisedCount, 1);
  assert.equal(pageEvidence(snapshot(1, 0, 0, []), 1).totalPages, 1);
  for (const value of [snapshot(2), snapshot(1, 21), snapshot(1, null), snapshot(1, 1, -1), { ...snapshot(), cat1: {} }]) assert.throws(() => pageEvidence(value, 1));
});

test('completeness counts building units without inventing unit rows', () => {
  const result = completeSearch([pageEvidence(snapshot(1, 2, 4, [row('building-opaque', 3)]), 1), pageEvidence(snapshot(2, 2, 4, [row('2')]), 2)]);
  assert.equal(result.complete, true);
  assert.equal(result.advertisedCount, 4);
  assert.equal(result.rowCount, 2);
  assert.equal(result.listings[0].id, 'building-opaque');
  assert.equal(result.listings[0].isBuilding, true);
  assert.equal(result.pages[0].rows, undefined);
  assert.equal(completeSearch([pageEvidence(snapshot(1, 0, 0, []), 1)]).rowCount, 0);
});

test('completeness rejects missing pages, duplicate IDs, invalid counts/URLs/identities', () => {
  const one = pageEvidence(snapshot(), 1);
  for (const pages of [[], [{ ...one, number: 2 }], [{ ...one, totalPages: 2 }], [{ ...one, advertisedCount: 2 }], [{ ...one, rows: [row('1'), row('1')], advertisedCount: 2 }], [{ ...one, rows: [row('1', 0)] }], [{ ...one, rows: [row('1', 1.5)] }], [{ ...one, rows: [{ ...row('1'), zpid: '' }] }], [{ ...one, rows: [{ ...row('1'), detailUrl: 'https://evil.test/a' }] }], [{ ...one, rows: [{ ...row('1'), detailUrl: '/' }] }]]) assert.throws(() => completeSearch(pages));
});

function mockBrowser(snapshots, { detachFails = false } = {}) {
  const events = [];
  let index = 0;
  const page = { goto: async (url, options) => { events.push(['goto', url, options]); }, close: async () => { events.push(['close']); } };
  const session = { send: async () => ({ result: { value: JSON.stringify(snapshots[Math.min(index++, snapshots.length - 1)]) } }), detach: async () => { events.push(['detach']); if (detachFails) throw new Error('detach'); } };
  const context = { newPage: async () => page, newCDPSession: async () => session };
  return { context, session, events };
}

test('reader opens owned tab, waits for hydration, verifies every page then cleans up', async () => {
  const mock = mockBrowser([{ url, text: 'loading' }, snapshot(1, 2, 4, [row('building', 3)]), snapshot(2, 2, 4, [row('2')])]);
  const waits = [];
  const result = await readSearch(mock.context, url, { sleep: async ms => waits.push(ms) });
  assert.equal(result.advertisedCount, 4);
  assert.deepEqual(waits, [1000, 1500]);
  assert.deepEqual(mock.events.slice(-2), [['detach'], ['close']]);
  const navigations = mock.events.filter(e => e[0] === 'goto');
  assert.deepEqual(navigations.map(e => JSON.parse(new URL(e[1]).searchParams.get('searchQueryState')).pagination.currentPage), [1, 2]);
});

test('reader stops on challenges, stale scope, changed totals, wrong pages and cleanup errors', async () => {
  const stale = snapshot();
  stale.query = { ...query, filterState: {} };
  const cases = [
    [{ ...snapshot(), text: 'CAPTCHA Rental listings' }],
    [stale],
    [snapshot(1, 2, 2), snapshot(2, 1, 2, [row('2')])],
    [snapshot(1, 2, 2), snapshot(1, 2, 2, [row('2')])],
    [snapshot(1, 2, 2), snapshot(2, 2, 3, [row('2')])],
  ];
  for (const snapshots of cases) {
    const mock = mockBrowser(snapshots);
    await assert.rejects(readSearch(mock.context, url, { sleep: async () => {} }));
    assert.deepEqual(mock.events.slice(-2), [['detach'], ['close']]);
  }
  await assert.rejects(readSearch(mockBrowser([snapshot()], { detachFails: true }).context, url, { sleep: async () => {} }), /cleanup failed/);
});

test('render polling is bounded and CDP exception is not a successful empty search', async () => {
  const mock = mockBrowser([{ url, text: 'loading' }]);
  await assert.rejects(waitForSearch(mock.session, { attempts: 2, sleep: async () => {} }), /did not render/);
  await assert.rejects(waitForSearch({ send: async () => ({ exceptionDetails: {} }) }), /CDP/);
});
