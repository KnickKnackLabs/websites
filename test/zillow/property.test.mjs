import test from 'node:test';
import assert from 'node:assert/strict';
import { propertyRecord } from '../../scripts/zillow/property.mjs';

const RENTAL_SOURCE = {
  zpid: 123,
  price: 1700,
  homeStatus: 'FOR_RENT',
  bedrooms: 3,
  description: '2BR plus study. Tenant pays utilities.',
  resoFacts: { petsAllowed: true },
};

function sourceEvidence(properties = [RENTAL_SOURCE]) {
  return {
    checked: 'now',
    listing: {
      url: 'https://www.zillow.com/homedetails/example/123_zpid/',
      id: '123',
      title: 'Rental',
      text: 'Nearby home rent $9999',
      properties,
      photos: [],
      ogImage: null,
    },
    calculator: {
      text: 'Estimated total $1700',
      expandedListing: { text: 'expanded page' },
    },
    photoScope: 'rendered_images_only',
  };
}

function showSource(source) {
  return propertyRecord(sourceEvidence([source]));
}

test('property record preserves structured facts and conflicting narrative without inference', () => {
  const record = propertyRecord(sourceEvidence());

  assert.deepEqual(record.price, { amount: 1700, kind: 'monthly_rent' });
  assert.equal(record.monthlyRent, 1700);
  assert.equal(record.askingPrice, null);
  assert.equal(record.bedrooms, 3);
  assert.equal(record.description, RENTAL_SOURCE.description);
  assert.equal(record.address, null);
  assert.equal(record.allInRent, undefined);
  assert.deepEqual(record.rentalFacts, { petsAllowed: true });
});

test('property record omits raw and expanded page copies', () => {
  const record = propertyRecord(sourceEvidence());
  assert.equal(record.evidence, undefined);
  assert.equal(record.calculator.expandedListing, undefined);
  assert.equal(record.calculator.text, 'Estimated total $1700');
});

test('conflicting hydrated prices remain explicit', () => {
  const sources = [RENTAL_SOURCE, { ...RENTAL_SOURCE, price: 1800 }];
  const record = propertyRecord(sourceEvidence(sources));
  assert.deepEqual(record.price.amount, { conflictingValues: [1700, 1800] });
});

test('off-market price without valuation provenance is unspecified, not rent', () => {
  const record = showSource({ homeStatus: 'OTHER', price: 245000 });
  assert.deepEqual(record.price, { amount: 245000, kind: 'unspecified' });
  assert.equal(record.monthlyRent, null);
  assert.equal(record.askingPrice, null);
});

test('valuation and rent estimates stay separate from advertised rent', () => {
  const record = showSource({
    homeStatus: 'OTHER',
    price: 245000,
    zestimate: 245000,
    rentZestimate: 1500,
  });
  assert.equal(record.price.kind, 'zestimate');
  assert.equal(record.zestimate, 245000);
  assert.equal(record.rentZestimate, 1500);
  assert.equal(record.monthlyRent, null);
});

test('for-sale asking price is not monthly rent', () => {
  const record = showSource({ homeStatus: 'FOR_SALE', price: 300000 });
  assert.equal(record.askingPrice, 300000);
  assert.equal(record.monthlyRent, null);
});

test('conflicting home statuses do not establish rent even when prices match', () => {
  const sources = [
    { homeStatus: 'FOR_RENT', price: 1500 },
    { homeStatus: 'OTHER', price: 1500 },
  ];
  const record = propertyRecord(sourceEvidence(sources));
  assert.equal(record.price.kind, 'unspecified');
  assert.equal(record.monthlyRent, null);
});
