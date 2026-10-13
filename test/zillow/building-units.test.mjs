import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingUnits } from '../../scripts/zillow/building-units.mjs';
import { propertyRecord } from '../../scripts/zillow/property.mjs';
import { listingEvidence, requestedListing } from '../../scripts/zillow/listing.mjs';

const BUILDING_URL = 'https://www.zillow.com/apartments/example-city/example-building/AbCd/';
const UNIT = {
  zpid: '123',
  feedModelId: 'feed-123',
  unitNumber: 'Unit 124',
  beds: 1,
  baths: 1,
  sqft: 713,
  price: 1455,
  baseRent: 1455,
  totalRequiredMonthlyMinFee: 160,
  totalRequiredMonthlyMaxFee: 160,
  listPriceIncludesRequiredMonthlyFees: false,
  availableFrom: '1792825200000',
  leaseTermDetail: { leaseTerm: '12 Months' },
  allowedPets: ['Cats', 'Dogs'],
};

function building(units = [UNIT]) {
  return {
    bdpUrl: '/apartments/example-city/example-building/AbCd/',
    lotId: 'building-1',
    buildingName: 'Example building',
    floorPlans: [{ name: 'One bedroom', minPrice: 1000, maxPrice: 2000, units }],
    ungroupedUnits: null,
    rentalUnitsSummary: { availableUnitCount: units.length },
    buildingAttributes: { unitCount: 240 },
  };
}

function buildingSnapshot(source) {
  return {
    url: BUILDING_URL,
    canonicalUrl: BUILDING_URL,
    text: 'Available units',
    properties: [],
    building: source,
  };
}

test('explicit units retain base rent, monthly fees and provider availability separately', () => {
  const result = buildingUnits(building());
  assert.equal(result.complete, true);
  assert.equal(result.count, 1);
  assert.equal(result.advertisedCount, 1);
  const unit = result.units[0];
  assert.equal(unit.unitNumber, 'Unit 124');
  assert.equal(unit.pricing.price, 1455);
  assert.equal(unit.pricing.baseRent, 1455);
  assert.equal(unit.pricing.includesRequiredMonthlyFees, false);
  assert.deepEqual(unit.pricing.requiredMonthlyFees, { minimum: 160, maximum: 160 });
  assert.equal(unit.availableFrom.source, UNIT.availableFrom);
  assert.equal(unit.availableFrom.instant, new Date(Number(UNIT.availableFrom)).toISOString());
  assert.deepEqual(unit.leaseTerm, UNIT.leaseTermDetail);
  assert.equal(unit.allInRent, undefined);
  assert.equal(unit.url, undefined);
});

test('floor-plan ranges are not substituted for missing unit prices', () => {
  const result = buildingUnits(building([{ zpid: '123' }]));
  assert.equal(result.units[0].pricing.price, null);
  assert.equal(result.units[0].bedrooms, null);
  assert.equal(result.units[0].floorPlan.name, 'One bedroom');
});

test('ungrouped units are collected without inventing floor-plan context', () => {
  const source = building([]);
  source.ungroupedUnits = [UNIT];
  source.rentalUnitsSummary.availableUnitCount = 1;
  const result = buildingUnits(source);
  assert.equal(result.complete, true);
  assert.equal(result.units[0].floorPlan, null);
});

test('available count, not physical building size, proves collection completeness', () => {
  const result = buildingUnits(building());
  assert.equal(result.complete, true);
  assert.equal(result.advertisedCount, 1);
  assert.equal(result.scope, 'provider_reported_available_units');
});

test('missing or changed advertised count prevents a completeness claim', () => {
  const missing = building();
  delete missing.rentalUnitsSummary;
  assert.deepEqual(buildingUnits(missing).reasons, ['available_unit_count_missing']);

  const changed = building();
  changed.rentalUnitsSummary.availableUnitCount = 2;
  assert.deepEqual(buildingUnits(changed).reasons, ['available_unit_count_mismatch']);
});

test('duplicate identities stay visible instead of silently deduplicating units', () => {
  const result = buildingUnits(building([UNIT, UNIT]));
  assert.equal(result.complete, false);
  assert.equal(result.count, 2);
  assert.deepEqual(result.reasons, ['duplicate_unit_identity']);
});

test('missing identity and invalid collections prevent a completeness claim', () => {
  assert.equal(buildingUnits(building([{}])).complete, false);
  assert.equal(buildingUnits(building([{ zpid: {} }])).complete, false);
  const source = building();
  source.floorPlans[0].units = null;
  assert.equal(buildingUnits(source).complete, false);
  assert.equal(buildingUnits(null).complete, false);
});

test('feed identity or a building-scoped unit number can identify units without zpid', () => {
  assert.equal(buildingUnits(building([{ feedModelId: 'feed-1' }])).units[0].id, 'feed:feed-1');
  assert.equal(buildingUnits(building([{ unitNumber: 'Unit 124' }])).units[0].id, 'number:Unit 124');
});

test('explicit empty collections and zero available count form a complete empty result', () => {
  const result = buildingUnits(building([]));
  assert.equal(result.complete, true);
  assert.deepEqual(result.units, []);
});

test('hydrated building identity must match the requested building, not neighboring data', () => {
  const request = requestedListing(BUILDING_URL);
  const evidence = listingEvidence(buildingSnapshot(building()), request);
  assert.equal(evidence.building.lotId, 'building-1');

  const otherBuilding = building();
  otherBuilding.bdpUrl = '/apartments/example-city/another-building/Other/';
  assert.throws(() => listingEvidence(buildingSnapshot(otherBuilding), request), /identity differs/);
  const missingIdentity = building();
  delete missingIdentity.bdpUrl;
  assert.throws(() => listingEvidence(buildingSnapshot(missingIdentity), request), /identity is missing/);
});

test('property show keeps building metadata and available units separate from individual rent', () => {
  const evidence = listingEvidence(buildingSnapshot(building()), requestedListing(BUILDING_URL));
  const record = propertyRecord({ listing: evidence });
  assert.equal(record.building.name, 'Example building');
  assert.equal(record.availableUnits.complete, true);
  assert.equal(record.monthlyRent, null);
  assert.equal(record.availableUnits.units[0].pricing.baseRent, 1455);
});
