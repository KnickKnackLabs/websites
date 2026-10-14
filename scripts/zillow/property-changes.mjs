import { isDeepStrictEqual } from 'node:util';
import { requestedListing } from './listing.mjs';

const propertyFields = [
  'address', 'price', 'zestimate', 'rentZestimate', 'homeStatus', 'bedrooms', 'bathrooms', 'livingArea',
  'livingAreaUnits', 'homeType', 'latitude', 'longitude', 'description',
  'rentalFacts', 'sections', 'building',
];
const unitFields = [
  'unitNumber', 'bedrooms', 'bathrooms', 'livingArea', 'floor', 'pricing',
  'availableFrom', 'leaseTerm', 'allowedPets', 'depositsAndFees',
  'specialOffers', 'description', 'additionalInformation', 'floorPlan',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Accept the public property output, not raw listing hydration or a parked read.
export function propertySnapshot(input) {
  if (input?.status === 'complete') input = input.result;
  if (!isRecord(input) || !['individual_property', 'building'].includes(input.recordType)) {
    throw new Error('Expected saved property show output or a completed property intervention');
  }
  const requested = requestedListing(input.url);
  const individual = input.recordType === 'individual_property';
  if (individual !== Boolean(requested.id) || input.id !== requested.id) {
    throw new Error('Snapshot property identity does not match its URL');
  }
  if (typeof input.checked !== 'string' || !Number.isFinite(Date.parse(input.checked))) {
    throw new Error('Snapshot checked timestamp is missing or invalid');
  }
  if (!isRecord(input.price) || !isRecord(input.sections) || !isRecord(input.calculator)) {
    throw new Error('Snapshot is missing property pricing, sections or calculator evidence');
  }
  if (!individual) unitIndex(input.availableUnits);
  return input;
}

function fieldChanges(before, after, fields) {
  const changes = [];
  for (const field of fields) {
    const previous = before[field] ?? null;
    const current = after[field] ?? null;
    if (!isDeepStrictEqual(previous, current)) {
      changes.push({ field, before: previous, after: current });
    }
  }
  return changes;
}

function unitIndex(collection) {
  if (!isRecord(collection) || typeof collection.complete !== 'boolean' || !Array.isArray(collection.units)) {
    throw new Error('Snapshot is missing a valid availableUnits collection');
  }
  const index = new Map();
  for (const unit of collection.units) {
    if (!isRecord(unit) || typeof unit.id !== 'string' || !unit.id || index.has(unit.id)) {
      throw new Error('Snapshot unit identities are missing or duplicated; cannot compare units');
    }
    index.set(unit.id, unit);
  }
  if (collection.complete && (
    collection.count !== index.size || collection.advertisedCount !== index.size
  )) {
    throw new Error('Snapshot complete unit collection has inconsistent counts');
  }
  return index;
}

function compareUnits(before, after, warnings) {
  const previous = unitIndex(before);
  const current = unitIndex(after);
  const membershipCompared = before.complete && after.complete;
  const added = [];
  const removed = [];
  const changed = [];

  if (!membershipCompared) warnings.push('unit_membership_not_compared_incomplete_collection');
  for (const id of [...current.keys()].sort()) {
    const unit = current.get(id);
    const priorUnit = previous.get(id);
    if (!priorUnit) {
      if (membershipCompared) added.push(unit);
      continue;
    }
    const changes = fieldChanges(priorUnit, unit, unitFields);
    if (changes.length) changed.push({ id, unitNumber: unit.unitNumber ?? null, changes });
  }
  if (membershipCompared) {
    for (const id of [...previous.keys()].sort()) {
      if (!current.has(id)) removed.push(previous.get(id));
    }
  }
  return { membershipCompared, added, removed, changed };
}

function calculatorScope(calculator) {
  if (!calculator.unit) return { kind: 'property_or_building_default' };
  const { id, requested, selectedUnit, estimatedUnit } = calculator.unit;
  if (typeof id !== 'string' || !id || typeof requested !== 'string' || !requested
    || selectedUnit !== requested || estimatedUnit !== requested) {
    throw new Error('Snapshot calculator unit attribution is invalid');
  }
  return { kind: 'unit', id, number: requested };
}

function compareCalculator(before, after, recordType, warnings) {
  const previousScope = calculatorScope(before);
  const currentScope = calculatorScope(after);
  if (typeof before.text !== 'string' || !before.text.trim()
    || typeof after.text !== 'string' || !after.text.trim()) {
    warnings.push('calculator_not_compared_missing_evidence');
    return { compared: false, changes: [] };
  }
  if (recordType === 'building' && (
    previousScope.kind !== 'unit' || currentScope.kind !== 'unit'
  )) {
    warnings.push('calculator_not_compared_unattributed_building_unit');
    return { compared: false, changes: [] };
  }
  if (!isDeepStrictEqual(previousScope, currentScope)) {
    warnings.push('calculator_not_compared_different_scope');
    return { compared: false, changes: [] };
  }
  return { compared: true, scope: currentScope, changes: fieldChanges(before, after, ['text']) };
}

export function propertyChanges(beforeInput, afterInput) {
  const before = propertySnapshot(beforeInput);
  const after = propertySnapshot(afterInput);
  const previousIdentity = requestedListing(before.url);
  const currentIdentity = requestedListing(after.url);
  const sameIdentity = previousIdentity.id
    ? previousIdentity.id === currentIdentity.id
    : previousIdentity.path === currentIdentity.path;
  if (before.recordType !== after.recordType || !sameIdentity) {
    throw new Error('Cannot compare snapshots of different properties');
  }
  if (Date.parse(after.checked) < Date.parse(before.checked)) {
    throw new Error('After snapshot predates before snapshot');
  }

  const warnings = [];
  const changes = fieldChanges(before, after, propertyFields);
  const units = before.recordType === 'building'
    ? compareUnits(before.availableUnits, after.availableUnits, warnings)
    : null;
  const calculator = compareCalculator(before.calculator, after.calculator, before.recordType, warnings);
  const changed = changes.length > 0 || calculator.changes.length > 0
    || Boolean(units && (units.added.length || units.removed.length || units.changed.length));

  return {
    scope: 'saved_property_evidence',
    url: after.url,
    id: after.id,
    recordType: after.recordType,
    beforeChecked: before.checked,
    afterChecked: after.checked,
    changed,
    changes,
    units,
    calculator,
    warnings,
  };
}
