import test from 'node:test';
import assert from 'node:assert/strict';
import { propertyRecord } from '../../scripts/zillow/property.mjs';

test('property record uses hydrated facts, keeps narrative and conflicting sources separate', () => {
  const source = { zpid: 123, price: 1700, bedrooms: 3, description: '2BR plus study. Tenant pays utilities.', resoFacts: { petsAllowed: true } };
  const record = propertyRecord({ checked: 'now', listing: { url: 'example', id: '123', title: 'Rental', text: 'Nearby home rent $9999', properties: [source], photos: [], ogImage: null }, calculator: { text: 'Estimated total $1700' }, photoScope: 'rendered_images_only' });
  assert.equal(record.price, 1700);
  assert.equal(record.bedrooms, 3);
  assert.equal(record.description, source.description);
  assert.equal(record.address, null);
  assert.equal(record.allInRent, undefined);
  assert.equal(record.evidence, undefined);
  assert.equal(record.calculator.expandedListing, undefined);
  assert.deepEqual(record.rentalFacts, { petsAllowed: true });
  const conflict = propertyRecord({ checked: 'now', listing: { properties: [source, { ...source, price: 1800 }] } });
  assert.deepEqual(conflict.price, { conflictingValues: [1700, 1800] });
});
