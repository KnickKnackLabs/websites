// Floor plans describe layouts; only their explicit units (and ungroupedUnits)
// describe available listings. Never synthesize a unit from a floor-plan range.
function sourceIdentifier(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

function unitIdentity(unit) {
  const zpid = sourceIdentifier(unit.zpid);
  if (zpid) return `zpid:${zpid}`;
  const feedId = sourceIdentifier(unit.feedModelId);
  if (feedId) return `feed:${feedId}`;
  const number = sourceIdentifier(unit.unitNumber);
  return number ? `number:${number}` : null;
}

function availableFrom(value) {
  let instant = null;
  if (value !== null && value !== undefined && /^\d+$/.test(String(value))) {
    const milliseconds = Number(value);
    const date = new Date(milliseconds);
    if (Number.isSafeInteger(milliseconds) && !Number.isNaN(date.getTime())) {
      instant = date.toISOString();
    }
  }
  return { source: value ?? null, instant };
}

function unitRecord(unit, plan) {
  return {
    id: unitIdentity(unit),
    zpid: sourceIdentifier(unit.zpid),
    feedModelId: sourceIdentifier(unit.feedModelId),
    unitNumber: unit.unitNumber ?? null,
    bedrooms: unit.beds ?? null,
    bathrooms: unit.baths ?? null,
    livingArea: unit.sqft ?? null,
    floor: unit.floor ?? null,
    pricing: {
      price: unit.price ?? null,
      minPrice: unit.minPrice ?? null,
      maxPrice: unit.maxPrice ?? null,
      baseRent: unit.baseRent ?? null,
      includesRequiredMonthlyFees: unit.listPriceIncludesRequiredMonthlyFees ?? null,
      requiredMonthlyFees: {
        minimum: unit.totalRequiredMonthlyMinFee ?? null,
        maximum: unit.totalRequiredMonthlyMaxFee ?? null,
      },
    },
    availableFrom: availableFrom(unit.availableFrom),
    leaseTerm: unit.leaseTermDetail ?? null,
    allowedPets: unit.allowedPets ?? null,
    depositsAndFees: unit.depositsAndFees ?? null,
    specialOffers: unit.specialOffers ?? null,
    description: unit.description ?? null,
    additionalInformation: unit.additionalInformation ?? null,
    photos: unit.galleryPhotos ?? [],
    floorPlan: plan ? {
      name: plan.name ?? null,
      bedrooms: plan.beds ?? null,
      bathrooms: plan.baths ?? null,
      livingArea: plan.sqft ?? null,
    } : null,
  };
}

export function buildingUnits(building) {
  if (!building) {
    return { complete: false, advertisedCount: null, count: 0, reasons: ['building_hydration_missing'], units: [] };
  }

  const units = [];
  const reasons = new Set();
  const identities = new Set();

  function collect(sourceUnits, plan) {
    if (!Array.isArray(sourceUnits)) {
      reasons.add('unit_records_missing_or_invalid');
      return;
    }
    for (const source of sourceUnits) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        reasons.add('invalid_unit_record');
        continue;
      }
      const unit = unitRecord(source, plan);
      if (!unit.id) reasons.add('unit_identity_missing');
      else if (identities.has(unit.id)) reasons.add('duplicate_unit_identity');
      else identities.add(unit.id);
      units.push(unit);
    }
  }

  if (Array.isArray(building.floorPlans)) {
    for (const plan of building.floorPlans) {
      if (!plan || typeof plan !== 'object') {
        reasons.add('invalid_floor_plan');
        continue;
      }
      collect(plan.units, plan);
    }
  } else if (building.floorPlans != null) {
    reasons.add('floor_plans_invalid');
  }
  if (building.ungroupedUnits != null) collect(building.ungroupedUnits, null);
  if (building.floorPlans == null && building.ungroupedUnits == null) {
    reasons.add('unit_records_missing_or_invalid');
  }

  const summary = building.rentalUnitsSummary;
  const advertisedCount = Number.isSafeInteger(summary?.availableUnitCount) && summary.availableUnitCount >= 0
    ? summary.availableUnitCount
    : null;
  if (advertisedCount === null) reasons.add('available_unit_count_missing');
  else if (units.length !== advertisedCount) reasons.add('available_unit_count_mismatch');

  return {
    complete: reasons.size === 0,
    scope: 'provider_reported_available_units',
    advertisedCount,
    count: units.length,
    reasons: [...reasons],
    units,
  };
}

export function buildingRecord(building) {
  if (!building) return null;
  return {
    lotId: building.lotId ?? null,
    name: building.buildingName ?? null,
    address: {
      streetAddress: building.streetAddress ?? null,
      city: building.city ?? null,
      state: building.state ?? null,
      zipcode: building.zipcode ?? null,
    },
    latitude: building.latitude ?? null,
    longitude: building.longitude ?? null,
    currency: building.currency ?? null,
    buildingType: building.buildingType ?? null,
    description: building.description ?? null,
    amenities: building.structuredAmenities ?? null,
    petPolicy: building.detailedPetPolicy ?? null,
  };
}
