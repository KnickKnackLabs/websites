import test from 'node:test';
import assert from 'node:assert/strict';
import { propertyMedia } from '../../scripts/zillow/property-media.mjs';
import { propertyRecord } from '../../scripts/zillow/property.mjs';

const kitchen = {
  url: 'https://photos.zillowstatic.com/example-kitchen.jpg',
  caption: 'Kitchen',
  mixedSources: { webp: [{ url: 'https://photos.zillowstatic.com/example-kitchen.webp', width: 800 }] },
};
const layout = { url: 'https://photos.zillowstatic.com/example-layout.jpg' };

function individual(property = {}) {
  return { id: '123', properties: [{ zpid: 123, ...property }] };
}

function community(building = {}) {
  return { id: null, properties: [], building };
}

function onePlan() {
  return {
    name: 'Two bedroom',
    photos: [layout],
    floorPlanUnitGalleryPhotos: [kitchen],
    units: [{ zpid: 42, unitNumber: 'Unit 42', galleryPhotos: [kitchen], floorPlanPhotos: [layout] }],
  };
}

test('property gallery keeps captions and supplied variants without rendered neighbors', () => {
  const listing = {
    ...individual({ responsivePhotos: [kitchen], photoCount: 1 }),
    photos: [{ url: 'https://photos.zillowstatic.com/neighbor.jpg' }],
    ogImage: 'https://example.test/map.jpg',
  };
  const media = propertyMedia(listing);

  assert.equal(media.scope, 'identity_checked_property');
  assert.deepEqual(media.gallery.items, [kitchen]);
  assert.equal(media.gallery.source, 'property.responsivePhotos');
  assert.equal(media.gallery.countMatches, true);
  assert.equal(JSON.stringify(media).includes('neighbor.jpg'), false);
  assert.equal(JSON.stringify(media).includes('map.jpg'), false);
});

test('media from unidentified or different property cache entries is excluded', () => {
  const listing = individual({ responsivePhotos: [kitchen] });
  listing.properties.push({ responsivePhotos: [layout] }, { zpid: 999, responsivePhotos: [layout] });
  const media = propertyMedia(listing);
  assert.equal(media.status, 'recorded');
  assert.deepEqual(media.gallery.items, [kitchen]);
});

test('alternate individual collections stay separate rather than matched by position', () => {
  const original = { caption: 'Original', mixedSources: kitchen.mixedSources };
  const media = propertyMedia(individual({
    responsivePhotos: [kitchen],
    responsivePhotosOriginalRatio: [original],
    originalPhotos: [original, original],
    photoCount: 1,
  }));

  assert.deepEqual(media.originalRatioPhotos.items, [original]);
  assert.equal(media.originalPhotos.count, 2);
  assert.equal(media.originalPhotos.countMatches, false);
  assert.deepEqual(media.gallery.items, [kitchen]);
});

test('missing photo and floor-plan sources do not claim the property has none', () => {
  const media = propertyMedia(individual({ interactiveFloorPlanUrl: '' }));
  assert.equal(media.gallery.status, 'missing');
  assert.equal(media.gallery.count, null);
  assert.equal(media.gallery.countMatches, null);
  assert.deepEqual(media.interactiveFloorPlan, {
    source: 'property.interactiveFloorPlanUrl', status: 'missing', url: null,
  });
});

test('an explicit empty collection is recorded without a completeness guarantee', () => {
  const media = propertyMedia(individual({ responsivePhotos: [] }));
  assert.equal(media.gallery.status, 'recorded');
  assert.equal(media.gallery.count, 0);
  assert.equal(media.gallery.countMatches, null);
  assert.equal(media.gallery.complete, undefined);
});

test('interactive floor-plan URL is retained only from its explicit property field', () => {
  const url = 'https://example.test/provider-supplied-tour';
  const media = propertyMedia(individual({ interactiveFloorPlanUrl: url }));
  assert.equal(media.interactiveFloorPlan.status, 'recorded');
  assert.equal(media.interactiveFloorPlan.url, url);
});

test('blank interactive floor-plan links are missing rather than recorded URLs', () => {
  const media = propertyMedia(individual({ interactiveFloorPlanUrl: '  ' }));
  assert.equal(media.interactiveFloorPlan.status, 'missing');
  assert.equal(media.interactiveFloorPlan.url, null);
});

test('invalid image records remain visible with an invalid collection status', () => {
  const media = propertyMedia(individual({ responsivePhotos: [{ caption: 'No image' }, null] }));
  assert.equal(media.gallery.status, 'invalid');
  assert.deepEqual(media.gallery.reasons, ['image_url_missing_or_invalid']);
  assert.deepEqual(media.gallery.items, [{ caption: 'No image' }, null]);
});

test('malformed photo collection is not presented as a valid empty gallery', () => {
  const media = propertyMedia(individual({ responsivePhotos: 'bad source' }));
  assert.equal(media.gallery.status, 'invalid');
  assert.equal(media.gallery.count, null);
});

test('equivalent hydration copies deduplicate regardless of object key order', () => {
  const listing = individual({ responsivePhotos: [kitchen] });
  listing.properties.push({ zpid: 123, responsivePhotos: [{
    mixedSources: kitchen.mixedSources, caption: kitchen.caption, url: kitchen.url,
  }] });
  const media = propertyMedia(listing);
  assert.equal(media.status, 'recorded');
  assert.deepEqual(media.gallery.items, [kitchen]);
});

test('competing property media sources are preserved, not combined or silently chosen', () => {
  const listing = individual({ responsivePhotos: [kitchen] });
  listing.properties.push({ zpid: 123, responsivePhotos: [layout] });
  const media = propertyMedia(listing);

  assert.equal(media.status, 'conflicting_sources');
  assert.equal(media.gallery, undefined);
  assert.deepEqual(media.sources.map(source => source.gallery.items), [[kitchen], [layout]]);
});

test('building gallery does not add overlapping amenity and signature collections', () => {
  const media = propertyMedia(community({
    galleryPhotos: [kitchen], photoCount: 1,
    amenityPhotos: [layout], signaturePhotos: [layout],
  }));
  assert.equal(media.scope, 'identity_checked_building');
  assert.deepEqual(media.gallery.items, [kitchen]);
  assert.equal(media.gallery.countMatches, true);
});

test('named layouts and representative interiors remain distinct from unit-associated media', () => {
  const disclaimer = 'Representative images; actual unit may differ.';
  const media = propertyMedia(community({ floorPlans: [onePlan()], floorPlanDisclaimer: disclaimer }));

  assert.deepEqual(media.floorPlans[0].images.items, [layout]);
  assert.deepEqual(media.floorPlans[0].representativeGallery.items, [kitchen]);
  assert.equal(media.floorPlans[0].name, 'Two bedroom');
  assert.equal(media.floorPlanDisclaimer, disclaimer);
  assert.equal(media.units[0].id, 'zpid:42');
  assert.equal(media.units[0].identityStatus, 'unique');
  assert.equal(media.units[0].floorPlanName, 'Two bedroom');
  assert.deepEqual(media.units[0].floorPlanImages.items, [layout]);
  assert.equal(media.unitPhotoScope, 'provider_associated_not_verified_exact_unit');
});

test('ungrouped unit media retains provider identity without invented plan context', () => {
  const media = propertyMedia(community({ ungroupedUnits: [{ feedModelId: 'feed-1', galleryPhotos: [kitchen] }] }));
  assert.equal(media.units[0].id, 'feed:feed-1');
  assert.equal(media.units[0].floorPlanName, null);
  assert.equal(media.units[0].floorPlanImages.status, 'missing');
});

test('duplicate unit identities are marked ambiguous rather than merged', () => {
  const media = propertyMedia(community({
    floorPlans: [onePlan()], ungroupedUnits: [{ zpid: 42, galleryPhotos: [layout] }],
  }));
  assert.equal(media.status, 'invalid');
  assert.deepEqual(media.units.map(unit => unit.identityStatus), ['duplicate', 'duplicate']);
  assert.equal(media.units.length, 2);
});

test('unit without identity remains explicitly unattributed', () => {
  const media = propertyMedia(community({ ungroupedUnits: [{ galleryPhotos: [kitchen] }] }));
  assert.equal(media.units[0].id, null);
  assert.equal(media.units[0].identityStatus, 'missing');
  assert.equal(media.status, 'invalid');
});

test('invalid floor-plan sources are reported without inventing layouts', () => {
  const media = propertyMedia(community({ floorPlans: 'bad source' }));
  assert.equal(media.floorPlanSourceStatus, 'invalid');
  assert.deepEqual(media.reasons, ['floor_plan_collection_invalid']);
  assert.deepEqual(media.floorPlans, []);
});

test('absent building hydration is missing media, not a verified empty community', () => {
  const media = propertyMedia(community(null));
  assert.equal(media.status, 'missing');
  assert.deepEqual(media.units, []);
});

test('property show adds scoped media without relabeling legacy rendered photos', () => {
  const photos = [{ url: 'https://photos.zillowstatic.com/neighbor.jpg', alt: 'Nearby' }];
  const listing = { ...individual({ responsivePhotos: [kitchen] }), photos };
  const record = propertyRecord({ listing, photoScope: 'rendered_images_only' });

  assert.deepEqual(record.media.gallery.items, [kitchen]);
  assert.deepEqual(record.photos, photos);
  assert.equal(record.photoScope, 'rendered_images_only');
});
