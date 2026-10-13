import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchUrl } from '../../scripts/zillow/search-url.mjs';
import { parseBrowserResult, runBrowser } from '../../scripts/zillow/task.mjs';

const state = config => JSON.parse(new URL(buildSearchUrl(config)).searchParams.get('searchQueryState'));
const region = { id: 123, type: 6 };
test('rent filters encode proven Zillow field names', () => {
  const actual = state({ region, filters: { max_rent: 2000, min_bedrooms: 2, min_bathrooms: 1.5, cats_allowed: false, in_unit_laundry: true, listing_age_days: 7, availability_date: '2028-02-29' } });
  assert.deepEqual(actual.regionSelection, [{ regionId: 123, regionType: 6 }]);
  assert.deepEqual(actual.filterState.monthlyPayment, { max: 2000 });
  assert.deepEqual(actual.filterState.baths, { min: 1.5 });
  assert.deepEqual(actual.filterState.onlyRentalCatsAllowed, { value: false });
  assert.deepEqual(actual.filterState.onlyRentalInUnitLaundry, { value: true });
  assert.deepEqual(actual.filterState.doz, { value: '7' });
  assert.equal(actual.filterState.isForRent.value, true);
  assert.equal(actual.filterState.isForSaleByAgent.value, false);
});
test('bounds without region work', () => {
  const bounds = { west: -80, east: -79, south: 35, north: 36 };
  assert.deepEqual(state({ map_bounds: bounds }).mapBounds, bounds);
});
test('strict schema rejects invalid configs', () => {
  for (const config of [null, [], {}, { region, title: 'private' }, { region: { id: 1 } }, { region: { id: true, type: 6 } }, { region, filters: { max_rent: 0 } }, { region, filters: { min_bedrooms: 1.5 } }, { region, filters: { min_bathrooms: Infinity } }, { region, filters: { cats_allowed: 'yes' } }, { region, filters: { listing_age_days: 2 } }, { region, filters: { availability_date: '2027-02-29' } }, { map_bounds: { west: 2, east: 1, south: 0, north: 1 } }, { region, filters: { max_rent: Number.MAX_SAFE_INTEGER + 1 } }, { region, filters: { maxRent: 100 } }]) assert.throws(() => buildSearchUrl(config));
});
test('browser result framing rejects missing, duplicate, malformed output', () => {
  assert.deepEqual(parseBrowserResult('Running: example\nWEBSITES_ZILLOW_RESULT={"ok":true}\n'), { ok: true });
  for (const text of ['', 'WEBSITES_ZILLOW_RESULT=no', 'WEBSITES_ZILLOW_RESULT={}\nWEBSITES_ZILLOW_RESULT={}']) assert.throws(() => parseBrowserResult(text));
});
test('browser runner passes explicit selection without obsolete site flag', () => {
  const result = runBrowser('/script.mjs', ['url'], { browser: 'b-test', spawn(command, args) {
    assert.equal(command, 'browser');
    assert.deepEqual(args, ['run', '--browser', 'b-test', '/script.mjs', 'url']);
    return { status: 0, stdout: 'WEBSITES_ZILLOW_RESULT={"ok":true}', stderr: '' };
  } });
  assert.equal(result.ok, true);
  assert.throws(() => runBrowser('script', [], { spawn: () => ({ status: 2, stdout: 'WEBSITES_ZILLOW_RESULT={}' }) }), /failed/);
});
