import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchUrl } from '../../scripts/zillow/search-url.mjs';

const region = { id: 123, type: 6 };

function encodedState(config) {
  const url = new URL(buildSearchUrl(config));
  return JSON.parse(url.searchParams.get('searchQueryState'));
}

function rentalConfig(filters) {
  return { region, filters };
}

test('rent filters encode proven Zillow field names', () => {
  const actual = encodedState(rentalConfig({
    max_rent: 2000,
    min_bedrooms: 2,
    min_bathrooms: 1.5,
    cats_allowed: false,
    in_unit_laundry: true,
    listing_age_days: 7,
    availability_date: '2028-02-29',
  }));

  assert.deepEqual(actual.regionSelection, [{ regionId: 123, regionType: 6 }]);
  assert.deepEqual(actual.filterState.monthlyPayment, { max: 2000 });
  assert.deepEqual(actual.filterState.beds, { min: 2 });
  assert.deepEqual(actual.filterState.baths, { min: 1.5 });
  assert.deepEqual(actual.filterState.onlyRentalCatsAllowed, { value: false });
  assert.deepEqual(actual.filterState.onlyRentalInUnitLaundry, { value: true });
  assert.deepEqual(actual.filterState.doz, { value: '7' });
  assert.deepEqual(actual.filterState.onlyRentalRequestedAvailabilityDate, { value: '2028-02-29' });
  assert.equal(actual.filterState.isForRent.value, true);

  const saleFilters = [
    'isForSaleByAgent', 'isForSaleByOwner', 'isNewConstruction',
    'isComingSoon', 'isAuction', 'isForSaleForeclosure',
  ];
  for (const name of saleFilters) assert.equal(actual.filterState[name].value, false, name);
});

test('map bounds can select a search without a region', () => {
  const bounds = { west: -80, east: -79, south: 35, north: 36 };
  assert.deepEqual(encodedState({ map_bounds: bounds }).mapBounds, bounds);
});

const invalidConfigs = [
  { name: 'null configuration', config: null, error: /search must be an object/ },
  { name: 'array configuration', config: [], error: /search must be an object/ },
  { name: 'missing location', config: {}, error: /Specify region or map_bounds/ },
  { name: 'household metadata', config: { region, title: 'private' }, error: /Unknown search fields/ },
  { name: 'missing region type', config: { region: { id: 1 } }, error: /region.type/ },
  { name: 'boolean region ID', config: { region: { id: true, type: 6 } }, error: /region.id/ },
  { name: 'zero rent', config: rentalConfig({ max_rent: 0 }), error: /max_rent.*out of range/ },
  { name: 'fractional bedrooms', config: rentalConfig({ min_bedrooms: 1.5 }), error: /min_bedrooms.*integer/ },
  { name: 'infinite bathrooms', config: rentalConfig({ min_bathrooms: Infinity }), error: /min_bathrooms.*finite/ },
  { name: 'string pet filter', config: rentalConfig({ cats_allowed: 'yes' }), error: /cats_allowed.*boolean/ },
  { name: 'unsupported listing age', config: rentalConfig({ listing_age_days: 2 }), error: /listing_age_days/ },
  { name: 'impossible calendar date', config: rentalConfig({ availability_date: '2027-02-29' }), error: /valid YYYY-MM-DD/ },
  { name: 'reversed bounds', config: { map_bounds: { west: 2, east: 1, south: 0, north: 1 } }, error: /west < east/ },
  { name: 'unsafe rent integer', config: rentalConfig({ max_rent: Number.MAX_SAFE_INTEGER + 1 }), error: /safe finite integer/ },
  { name: 'misspelled filter', config: rentalConfig({ maxRent: 100 }), error: /Unknown filters fields/ },
];

for (const { name, config, error } of invalidConfigs) {
  test(`search URL rejects ${name}`, () => {
    assert.throws(() => buildSearchUrl(config), error);
  });
}
