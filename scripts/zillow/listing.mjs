import { zillowUrl, evaluateJSON, withOwnedTab, delay } from './browser.mjs';
import { readListingPage } from './listing-page.mjs';
import { RESULT_PREFIX } from './browser-command.mjs';

const listingContent = /rental facts|what.s special|rental listing|available units|building overview|building details/i;
const renderAttempts = 15;
const renderIntervalMs = 1000;
const calculatorRenderDelayMs = 2000;

export function requestedListing(value) {
  const url = zillowUrl(value);
  const propertyId = url.pathname.match(/^\/homedetails\/[^/]+\/(\d+)_zpid\/?$/)?.[1];
  const isBuilding = /^\/b\/[^/]+\/[^/]+\/?$/.test(url.pathname);
  const isApartmentBuilding = /^\/apartments\/[^/]+\/[^/]+\/[^/]+\/?$/.test(url.pathname);

  if (!propertyId && !isBuilding && !isApartmentBuilding) {
    throw new Error('Expected a Zillow homedetails or building detail URL');
  }

  return {
    url: url.href,
    id: propertyId ?? null,
    path: url.pathname.replace(/\/$/, ''),
  };
}

function matchesRequestedListing(candidate, requested) {
  return requested.id ? candidate.id === requested.id : candidate.path === requested.path;
}

function requireHydratedIdentity(properties, requested) {
  if (!Array.isArray(properties)) throw new Error('Invalid listing property evidence');
  if (!requested.id) return; // Building pages need not expose individual-property hydration.

  const hydratedIds = properties
    .filter(property => property?.zpid != null)
    .map(property => String(property.zpid));

  if (!hydratedIds.length) {
    throw new Error('Hydrated listing identity is missing; identity not established');
  }
  if (hydratedIds.some(id => id !== requested.id)) {
    throw new Error('Hydrated listing identity differs from requested listing');
  }
}

function requireBuildingIdentity(building, requested) {
  if (!building) return;
  if (requested.id || typeof building !== 'object' || Array.isArray(building)) {
    throw new Error('Unexpected hydrated building evidence');
  }
  if (typeof building.bdpUrl !== 'string') {
    throw new Error('Hydrated building identity is missing');
  }
  const hydrated = requestedListing(new URL(building.bdpUrl, requested.url).href);
  if (!matchesRequestedListing(hydrated, requested)) {
    throw new Error('Hydrated building identity differs from requested listing');
  }
}

export function listingEvidence(snapshot, requested) {
  const current = requestedListing(snapshot.url);
  if (!matchesRequestedListing(current, requested)) {
    throw new Error('Rendered listing differs from requested listing');
  }
  if (snapshot.canonicalUrl) {
    const canonical = requestedListing(snapshot.canonicalUrl);
    if (!matchesRequestedListing(canonical, requested)) {
      throw new Error('Canonical listing differs from requested listing');
    }
  }

  const properties = snapshot.properties ?? [];
  requireHydratedIdentity(properties, requested);
  const building = snapshot.building ?? null;
  requireBuildingIdentity(building, requested);
  if (typeof snapshot.text !== 'string' || !listingContent.test(snapshot.text)) {
    throw new Error('Listing did not render usable details');
  }

  return {
    url: current.url,
    canonicalUrl: snapshot.canonicalUrl ?? null,
    id: current.id,
    title: snapshot.title ?? null,
    text: snapshot.text,
    properties,
    building,
    sections: snapshot.sections ?? {},
    photos: snapshot.photos ?? [],
    ogImage: snapshot.ogImage ?? null,
  };
}

async function waitForListing(session, requested, sleep) {
  for (let attempt = 0; attempt < renderAttempts; attempt++) {
    const snapshot = await evaluateJSON(session, readListingPage);
    if (listingContent.test(snapshot.text ?? '')) {
      // Retry loading, not a mismatched identity or a challenge.
      return listingEvidence(snapshot, requested);
    }
    if (attempt + 1 < renderAttempts) await sleep(renderIntervalMs);
  }
  throw new Error('Listing did not render usable details');
}

async function readCalculator(session, requested, { enabled, sleep }) {
  const costs = {
    requested: enabled,
    clicked: false,
    reason: 'not_requested',
    text: null,
    expandedListing: null,
  };
  if (!enabled) return costs;

  const action = await evaluateJSON(session, readListingPage, ['open_calculator']);
  costs.clicked = action.clicked === true;
  costs.reason = action.reason ?? null;
  if (!costs.clicked) return costs;

  await sleep(calculatorRenderDelayMs);
  const expanded = await evaluateJSON(session, readListingPage);
  costs.expandedListing = listingEvidence(expanded, requested);
  costs.text = expanded.calculatorText ?? null;
  costs.reason = costs.text ? null : 'calculator_not_identified';
  return costs;
}

export async function readListing(context, value, {
  calculator = false,
  sleep = delay,
  page: resumedPage,
  onChallenge,
} = {}) {
  const requested = requestedListing(value);

  return withOwnedTab(context, async (page, session) => {
    if (!resumedPage) {
      await page.goto(requested.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    const listing = await waitForListing(session, requested, sleep);
    const costs = await readCalculator(session, requested, { enabled: calculator, sleep });

    return {
      checked: new Date().toISOString(),
      requestedUrl: requested.url,
      listing,
      calculator: costs,
      photoScope: 'rendered_images_only',
    };
  }, { page: resumedPage, onChallenge });
}

export default async function ({ context, args }) {
  const validArguments = args.length === 1 || (args.length === 2 && args[1] === '--calculator');
  if (!validArguments) throw new Error('Provide a listing URL and optional --calculator');

  const result = await readListing(context, args[0], { calculator: args[1] === '--calculator' });
  console.log(RESULT_PREFIX + JSON.stringify(result));
}
