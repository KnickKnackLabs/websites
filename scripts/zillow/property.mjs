import { readListing } from './listing.mjs';
import { RESULT_PREFIX } from './browser-command.mjs';

function sourceField(properties, field) {
  const distinctValues = new Map();
  for (const property of properties) {
    const value = property[field];
    if (value !== undefined && value !== null) {
      distinctValues.set(JSON.stringify(value), value);
    }
  }

  const values = [...distinctValues.values()];
  if (values.length > 1) return { conflictingValues: values };
  return values[0] ?? null;
}

function omitEmptyFacts(facts) {
  if (!facts || facts.conflictingValues) return facts;

  const populated = Object.entries(facts).filter(([, value]) => {
    if (value === null || value === undefined || value === '') return false;
    return !Array.isArray(value) || value.length > 0;
  });
  return Object.fromEntries(populated);
}

function propertyPricing(properties) {
  const amount = sourceField(properties, 'price');
  const status = sourceField(properties, 'homeStatus');
  const zestimate = sourceField(properties, 'zestimate');
  let kind = 'unspecified';

  // Only explicit provider status/valuation fields classify an amount. The
  // caller's rental search or nearby rental language is not price evidence.
  if (status === 'FOR_RENT') {
    kind = 'monthly_rent';
  } else if (['FOR_SALE', 'PENDING', 'AUCTION'].includes(status)) {
    kind = 'asking_price';
  } else if (typeof amount === 'number' && amount === zestimate) {
    kind = 'zestimate';
  }

  return {
    price: { amount, kind },
    monthlyRent: kind === 'monthly_rent' ? amount : null,
    askingPrice: kind === 'asking_price' ? amount : null,
    zestimate,
    rentZestimate: sourceField(properties, 'rentZestimate'),
  };
}

// Preserve direct provider facts and conflicting sources; do not infer policy
// from narrative or promote a building's price range to an individual rent.
export function propertyRecord(evidence) {
  const listing = evidence.listing;
  const properties = listing.properties;
  const { expandedListing, ...calculator } = evidence.calculator ?? {};

  return {
    checked: evidence.checked,
    url: listing.url,
    id: listing.id,
    recordType: listing.id ? 'individual_property' : 'building',
    address: sourceField(properties, 'address'),
    ...propertyPricing(properties),
    bedrooms: sourceField(properties, 'bedrooms'),
    bathrooms: sourceField(properties, 'bathrooms'),
    livingArea: sourceField(properties, 'livingArea'),
    livingAreaUnits: sourceField(properties, 'livingAreaUnits'),
    homeType: sourceField(properties, 'homeType'),
    homeStatus: sourceField(properties, 'homeStatus'),
    latitude: sourceField(properties, 'latitude'),
    longitude: sourceField(properties, 'longitude'),
    description: sourceField(properties, 'description'),
    rentalFacts: omitEmptyFacts(sourceField(properties, 'resoFacts')),
    sections: listing.sections ?? {},
    photos: listing.photos,
    primaryImage: listing.ogImage,
    calculator,
    title: listing.title ?? null,
    photoScope: evidence.photoScope,
  };
}

export async function readProperty(context, url, options = {}) {
  const result = await readListing(context, url, options);
  if (result.status === 'needs_human') return result;
  return propertyRecord(result);
}

export default async function ({ context, args }) {
  const validArguments = args.length === 1 || (args.length === 2 && args[1] === '--calculator');
  if (!validArguments) throw new Error('Provide a listing URL and optional --calculator');

  const result = await readProperty(context, args[0], { calculator: args[1] === '--calculator' });
  console.log(RESULT_PREFIX + JSON.stringify(result));
}
