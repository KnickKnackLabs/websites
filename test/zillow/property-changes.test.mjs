import test from 'node:test';
import assert from 'node:assert/strict';
import { propertyChanges } from '../../scripts/zillow/property-changes.mjs';

function snapshot(overrides = {}) {
  return {
    recordType: 'individual_property',
    id: '123',
    url: 'https://www.zillow.com/homedetails/example/123_zpid/',
    checked: '2026-10-01T12:00:00Z',
    price: { kind: 'monthly_rent', amount: 1500 },
    homeStatus: 'FOR_RENT',
    bedrooms: 2,
    rentalFacts: { petsAllowed: true },
    sections: { description: 'Tenant pays power.' },
    calculator: {},
    ...overrides,
  };
}

function unit(id, amount = 1500) {
  return { id, unitNumber: id, pricing: { baseRent: amount } };
}

function building(units, { complete = true, ...overrides } = {}) {
  return snapshot({
    recordType: 'building',
    id: null,
    url: 'https://www.zillow.com/b/example/AbCd/',
    availableUnits: { complete, count: units.length, advertisedCount: units.length, units },
    ...overrides,
  });
}

function unitCalculator(id, text) {
  return { text, unit: { id, requested: id, selectedUnit: id, estimatedUnit: id } };
}

test('reports price evidence before and after without inferring all-in cost', () => {
  const before = snapshot();
  const after = snapshot({ price: { kind: 'monthly_rent', amount: 1600 } });
  const result = propertyChanges(before, after);

  assert.equal(result.changed, true);
  assert.deepEqual(result.changes, [{ field: 'price', before: before.price, after: after.price }]);
  assert.equal(result.scope, 'saved_property_evidence');
  assert.equal(result.allInRent, undefined);
});

test('reports source facts becoming unknown rather than treating missing evidence as unchanged', () => {
  const result = propertyChanges(snapshot(), snapshot({ bedrooms: null }));
  assert.deepEqual(result.changes, [{ field: 'bedrooms', before: 2, after: null }]);
});

test('timestamps, photo URLs, title and object key order do not create property changes', () => {
  const before = snapshot({ photos: [{ url: 'old' }], title: 'Old title' });
  const after = snapshot({
    checked: '2026-10-02T12:00:00Z',
    price: { amount: 1500, kind: 'monthly_rent' },
    photos: [{ url: 'new' }],
    title: 'New title',
  });
  const result = propertyChanges(before, after);

  assert.equal(result.changed, false);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.warnings, ['calculator_not_compared_missing_evidence']);
});

test('accepts completed intervention wrappers with pending cleanup', () => {
  const completed = { status: 'complete', result: snapshot(), cleanup: { status: 'pending' } };
  assert.equal(propertyChanges(completed, snapshot()).changed, false);
});

test('rejects a parked intervention instead of interpreting it as a disappeared property', () => {
  assert.throws(() => propertyChanges(snapshot(), { status: 'needs_human' }), /Expected saved property/);
});

test('rejects comparing different property identities', () => {
  const different = snapshot({ id: '456', url: 'https://www.zillow.com/homedetails/other/456_zpid/' });
  assert.throws(() => propertyChanges(snapshot(), different), /different properties/);
});

test('accepts a renamed individual URL when Zillow property ID stays the same', () => {
  const renamed = snapshot({ url: 'https://www.zillow.com/homedetails/renamed/123_zpid/' });
  assert.equal(propertyChanges(snapshot(), renamed).changed, false);
});

test('rejects reversed chronological inputs', () => {
  const earlier = snapshot({ checked: '2026-09-01T12:00:00Z' });
  assert.throws(() => propertyChanges(snapshot(), earlier), /predates/);
});

test('rejects an invalid saved timestamp', () => {
  assert.throws(() => propertyChanges(snapshot(), snapshot({ checked: 'not a date' })), /timestamp/);
});

test('rejects a saved property ID that disagrees with its URL', () => {
  assert.throws(() => propertyChanges(snapshot(), snapshot({ id: '456' })), /identity/);
});

test('reports policy, narrative and valuation evidence separately', () => {
  const before = snapshot({ rentZestimate: 1400 });
  const after = snapshot({
    rentZestimate: 1450,
    rentalFacts: { petsAllowed: false },
    sections: { description: 'Tenant pays power and water.' },
  });
  const result = propertyChanges(before, after);
  assert.deepEqual(result.changes.map(change => change.field), ['rentZestimate', 'rentalFacts', 'sections']);
});

test('individual calculators compare displayed text with no unit selection', () => {
  const before = snapshot({ calculator: { text: 'Estimated monthly $1500' } });
  const after = snapshot({ calculator: { text: 'Estimated monthly $1600' } });
  assert.equal(propertyChanges(before, after).calculator.compared, true);
});

test('matches reordered building units by identity and reports changed pricing', () => {
  const before = building([unit('one'), unit('two')]);
  const after = building([unit('two'), unit('one', 1600)]);
  const result = propertyChanges(before, after);

  assert.deepEqual(result.units.added, []);
  assert.deepEqual(result.units.removed, []);
  assert.deepEqual(result.units.changed, [{
    id: 'one', unitNumber: 'one',
    changes: [{ field: 'pricing', before: { baseRent: 1500 }, after: { baseRent: 1600 } }],
  }]);
});

test('complete collections report provider-listed additions and removals', () => {
  const before = building([unit('old'), unit('shared')]);
  const after = building([unit('new'), unit('shared')]);
  const result = propertyChanges(before, after);

  assert.equal(result.units.membershipCompared, true);
  assert.deepEqual(result.units.added, [unit('new')]);
  assert.deepEqual(result.units.removed, [unit('old')]);
});

test('incomplete collection suppresses membership changes but compares shared unit evidence', () => {
  const before = building([unit('old'), unit('shared')]);
  const after = building([unit('shared', 1600), unit('new')], { complete: false });
  const result = propertyChanges(before, after);

  assert.equal(result.units.membershipCompared, false);
  assert.deepEqual(result.units.added, []);
  assert.deepEqual(result.units.removed, []);
  assert.equal(result.units.changed[0].id, 'shared');
  assert.ok(result.warnings.includes('unit_membership_not_compared_incomplete_collection'));
});

test('rejects duplicate unit identities before comparing', () => {
  const duplicate = building([unit('one'), unit('one')]);
  assert.throws(() => propertyChanges(building([]), duplicate), /duplicated/);
});

test('rejects complete collections whose counts do not support completeness', () => {
  const invalid = building([unit('one')]);
  invalid.availableUnits.advertisedCount = 2;
  assert.throws(() => propertyChanges(building([]), invalid), /inconsistent counts/);
});

test('compares calculator text for the same attributed unit without parsing an all-in quote', () => {
  const before = building([unit('one')], { calculator: unitCalculator('one', 'Estimate $1500') });
  const after = building([unit('one')], { calculator: unitCalculator('one', 'Estimate $1600') });
  const result = propertyChanges(before, after);

  assert.equal(result.calculator.compared, true);
  assert.deepEqual(result.calculator.changes, [{ field: 'text', before: 'Estimate $1500', after: 'Estimate $1600' }]);
});

test('different calculator unit selections are not comparable evidence', () => {
  const units = [unit('one'), unit('two')];
  const before = building(units, { calculator: unitCalculator('one', 'Estimate $1500') });
  const after = building(units, { calculator: unitCalculator('two', 'Estimate $1600') });
  const result = propertyChanges(before, after);

  assert.equal(result.changed, false);
  assert.equal(result.calculator.compared, false);
  assert.ok(result.warnings.includes('calculator_not_compared_different_scope'));
});

test('default building calculator has no unit attribution and is not compared', () => {
  const before = building([], { calculator: { text: 'Estimate $1500' } });
  const after = building([], { calculator: { text: 'Estimate $1600' } });
  const result = propertyChanges(before, after);

  assert.equal(result.calculator.compared, false);
  assert.ok(result.warnings.includes('calculator_not_compared_unattributed_building_unit'));
});

test('invalid calculator unit readback is rejected', () => {
  const invalid = unitCalculator('one', 'Estimate $1500');
  invalid.unit.estimatedUnit = 'two';
  const before = building([unit('one')], { calculator: invalid });
  assert.throws(() => propertyChanges(before, before), /attribution/);
});
