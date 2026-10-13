import { readListing } from './listing.mjs';
import { RESULT_PREFIX } from './task.mjs';

// Direct source fields only: do not turn descriptions into inferred policies.
export function propertyRecord(evidence) {
  const listing = evidence.listing;
  const sources = listing.properties;
  const values = key => {
    const unique = new Map();
    for (const source of sources) {
      const value = source[key];
      if (value !== undefined && value !== null) unique.set(JSON.stringify(value), value);
    }
    const found = [...unique.values()];
    return found.length > 1 ? { conflictingValues: found } : found[0] ?? null;
  };
  const facts = values('resoFacts');
  const compactFacts = facts && !facts.conflictingValues
    ? Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length)))
    : facts;
  const { expandedListing, ...calculator } = evidence.calculator ?? {};
  const amount = values('price');
  const status = values('homeStatus');
  const zestimate = values('zestimate');
  // Classify only from explicit provider status/valuation fields, never from
  // the URL, rental-search context, or a nearby page's rental language.
  const kind = status === 'FOR_RENT' ? 'monthly_rent'
    : ['FOR_SALE', 'PENDING', 'AUCTION'].includes(status) ? 'asking_price'
    : typeof amount === 'number' && amount === zestimate ? 'zestimate' : 'unspecified';
  return {
    checked: evidence.checked, url: listing.url, id: listing.id,
    address: values('address'), price: { amount, kind },
    monthlyRent: kind === 'monthly_rent' ? amount : null,
    askingPrice: kind === 'asking_price' ? amount : null,
    zestimate, rentZestimate: values('rentZestimate'), bedrooms: values('bedrooms'),
    bathrooms: values('bathrooms'), livingArea: values('livingArea'), livingAreaUnits: values('livingAreaUnits'),
    homeType: values('homeType'), homeStatus: values('homeStatus'),
    latitude: values('latitude'), longitude: values('longitude'),
    description: values('description'), rentalFacts: compactFacts,
    photos: listing.photos, primaryImage: listing.ogImage,
    calculator,
    title: listing.title ?? null,
    photoScope: evidence.photoScope,
  };
}

export async function readProperty(context, url, options = {}) {
  const result = await readListing(context, url, options);
  return result.status === 'needs_human' ? result : propertyRecord(result);
}

export default async function ({ context, args }) {
  if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== '--calculator')) throw new Error('Provide a listing URL and optional --calculator');
  console.log(RESULT_PREFIX + JSON.stringify(await readProperty(context, args[0], { calculator: args[1] === '--calculator' })));
}
