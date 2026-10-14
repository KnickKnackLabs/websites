import { isDeepStrictEqual } from 'node:util';
import { unitIdentity } from './building-units.mjs';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasImageUrl(image) {
  if (!isRecord(image)) return false;
  if (typeof image.url === 'string' && image.url.trim()) return true;
  if (!isRecord(image.mixedSources)) return false;

  return Object.values(image.mixedSources).some(variants =>
    Array.isArray(variants) && variants.some(variant =>
      isRecord(variant) && typeof variant.url === 'string' && variant.url.trim()));
}

// Retain supplied records, including captions and format/width variants. Counts
// describe this source collection, not everything Zillow might expose elsewhere.
function imageCollection(value, source, reportedCount = null) {
  const items = Array.isArray(value) ? value : [];
  const reasons = [];
  let status = 'recorded';

  if (value == null) status = 'missing';
  else if (!Array.isArray(value)) status = 'invalid';
  else if (!items.every(hasImageUrl)) {
    status = 'invalid';
    reasons.push('image_url_missing_or_invalid');
  }

  const countKnown = Number.isSafeInteger(reportedCount) && reportedCount >= 0;
  return {
    source,
    status,
    count: Array.isArray(value) ? items.length : null,
    reportedCount: countKnown ? reportedCount : null,
    countMatches: countKnown && status === 'recorded' ? items.length === reportedCount : null,
    reasons,
    items,
  };
}

function interactiveFloorPlan(value) {
  let status = 'missing';
  let url = null;
  if (value != null && typeof value !== 'string') status = 'invalid';
  else if (typeof value === 'string' && value.trim()) {
    status = 'recorded';
    url = value;
  }
  return { source: 'property.interactiveFloorPlanUrl', status, url };
}

function individualMedia(properties) {
  // Do not zip alternate photo arrays or combine competing hydration copies.
  // Each accepted owner supplies a complete, separate media view.
  const sources = [];
  for (const property of properties) {
    const view = {
      gallery: imageCollection(property.responsivePhotos, 'property.responsivePhotos', property.photoCount),
      originalRatioPhotos: imageCollection(property.responsivePhotosOriginalRatio,
        'property.responsivePhotosOriginalRatio', property.photoCount),
      originalPhotos: imageCollection(property.originalPhotos, 'property.originalPhotos', property.photoCount),
      interactiveFloorPlan: interactiveFloorPlan(property.interactiveFloorPlanUrl),
    };
    if (!sources.some(source => isDeepStrictEqual(source, view))) sources.push(view);
  }

  if (sources.length === 1) return { status: 'recorded', ...sources[0] };
  return { status: sources.length ? 'conflicting_sources' : 'missing', sources };
}

function buildingMedia(building) {
  if (!building) return { status: 'missing', floorPlans: [], units: [] };

  const floorPlans = [];
  const units = [];
  const reasons = new Set();

  function collectUnits(sourceUnits, source, planName) {
    if (sourceUnits == null) return;
    if (!Array.isArray(sourceUnits)) {
      reasons.add('unit_collection_invalid');
      return;
    }
    for (const [index, unit] of sourceUnits.entries()) {
      if (!isRecord(unit)) {
        reasons.add('unit_record_invalid');
        continue;
      }
      units.push({
        id: unitIdentity(unit),
        unitNumber: unit.unitNumber ?? null,
        floorPlanName: planName,
        gallery: imageCollection(unit.galleryPhotos, `${source}[${index}].galleryPhotos`),
        floorPlanImages: imageCollection(unit.floorPlanPhotos, `${source}[${index}].floorPlanPhotos`),
      });
    }
  }

  if (building.floorPlans != null && !Array.isArray(building.floorPlans)) {
    reasons.add('floor_plan_collection_invalid');
  }
  let floorPlanSourceStatus = 'missing';
  if (Array.isArray(building.floorPlans)) floorPlanSourceStatus = 'recorded';
  else if (building.floorPlans != null) floorPlanSourceStatus = 'invalid';

  const sourcePlans = Array.isArray(building.floorPlans) ? building.floorPlans : [];
  for (const [index, plan] of sourcePlans.entries()) {
    if (!isRecord(plan)) {
      reasons.add('floor_plan_record_invalid');
      continue;
    }
    const source = `building.floorPlans[${index}]`;
    floorPlans.push({
      name: plan.name ?? null,
      source,
      images: imageCollection(plan.photos, `${source}.photos`),
      representativeGallery: imageCollection(plan.floorPlanUnitGalleryPhotos, `${source}.floorPlanUnitGalleryPhotos`),
    });
    collectUnits(plan.units, `${source}.units`, plan.name ?? null);
  }
  collectUnits(building.ungroupedUnits, 'building.ungroupedUnits', null);

  const identityCounts = new Map();
  for (const unit of units) {
    if (unit.id) identityCounts.set(unit.id, (identityCounts.get(unit.id) ?? 0) + 1);
  }
  for (const unit of units) {
    unit.identityStatus = 'unique';
    if (!unit.id) unit.identityStatus = 'missing';
    else if (identityCounts.get(unit.id) > 1) unit.identityStatus = 'duplicate';
    if (unit.identityStatus !== 'unique') reasons.add('unit_identity_missing_or_duplicate');
  }

  return {
    status: reasons.size ? 'invalid' : 'recorded',
    reasons: [...reasons],
    gallery: imageCollection(building.galleryPhotos, 'building.galleryPhotos', building.photoCount),
    floorPlanSourceStatus,
    floorPlanDisclaimer: building.floorPlanDisclaimer ?? null,
    floorPlans,
    unitPhotoScope: 'provider_associated_not_verified_exact_unit',
    units,
  };
}

// Input is listingEvidence after URL/canonical and hydration identity checks.
// Never use global rendered images, maps, neighbors, or lightbox defaults here.
export function propertyMedia(listing) {
  const scope = listing.id ? 'identity_checked_property' : 'identity_checked_building';
  if (!listing.id) return { scope, ...buildingMedia(listing.building) };

  // A cache entry without a zpid does not establish ownership of its images,
  // even when another entry established the requested page's identity.
  const owners = listing.properties.filter(property =>
    isRecord(property) && property.zpid != null && String(property.zpid) === listing.id);
  return { scope, ...individualMedia(owners) };
}
