import test from 'node:test';
import assert from 'node:assert/strict';
import { propertyRecord } from '../../scripts/zillow/property.mjs';

test('property record uses hydrated facts, keeps narrative and conflicting sources separate', () => {
  const source = { zpid: 123, price: 1700, homeStatus: 'FOR_RENT', bedrooms: 3, description: '2BR plus study. Tenant pays utilities.', resoFacts: { petsAllowed: true } };
  const record = propertyRecord({ checked: 'now', listing: { url: 'example', id: '123', title: 'Rental', text: 'Nearby home rent $9999', properties: [source], photos: [], ogImage: null }, calculator: { text: 'Estimated total $1700' }, photoScope: 'rendered_images_only' });
  assert.deepEqual(record.price, { amount: 1700, kind: 'monthly_rent' });
  assert.equal(record.monthlyRent, 1700);
  assert.equal(record.askingPrice, null);
  assert.equal(record.bedrooms, 3);
  assert.equal(record.description, source.description);
  assert.equal(record.address, null);
  assert.equal(record.allInRent, undefined);
  assert.equal(record.evidence, undefined);
  assert.equal(record.calculator.expandedListing, undefined);
  assert.deepEqual(record.rentalFacts, { petsAllowed: true });
  const conflict = propertyRecord({ checked: 'now', listing: { properties: [source, { ...source, price: 1800 }] } });
  assert.deepEqual(conflict.price.amount, { conflictingValues: [1700, 1800] });
});

test('off-market values and estimates are never presented as monthly rent', () => {
  const record = source => propertyRecord({ listing: { properties: [source] } });
  const offMarket = record({ homeStatus: 'OTHER', price: 245000 });
  assert.deepEqual(offMarket.price, { amount: 245000, kind: 'unspecified' });
  assert.equal(offMarket.monthlyRent, null);
  assert.equal(offMarket.askingPrice, null);
  const estimate = record({ homeStatus: 'OTHER', price: 245000, zestimate: 245000, rentZestimate: 1500 });
  assert.equal(estimate.price.kind, 'zestimate');
  assert.equal(estimate.zestimate, 245000);
  assert.equal(estimate.rentZestimate, 1500);
  assert.equal(estimate.monthlyRent, null);
  const sale = record({ homeStatus: 'FOR_SALE', price: 300000 });
  assert.equal(sale.askingPrice, 300000);
  assert.equal(sale.monthlyRent, null);
  const ambiguous = propertyRecord({ listing: { properties: [{ homeStatus: 'FOR_RENT', price: 1500 }, { homeStatus: 'OTHER', price: 1500 }] } });
  assert.equal(ambiguous.price.kind, 'unspecified');
  assert.equal(ambiguous.monthlyRent, null);
});
