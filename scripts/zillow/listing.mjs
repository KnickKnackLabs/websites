import { zillowUrl, evaluateJSON, withOwnedTab, delay } from './browser.mjs';
import { readListingPage } from './listing-page.mjs';
import { RESULT_PREFIX } from './browser-command.mjs';
import { buildingUnits } from './building-units.mjs';

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
      return { listing: listingEvidence(snapshot, requested), snapshot };
    }
    if (attempt + 1 < renderAttempts) await sleep(renderIntervalMs);
  }
  throw new Error('Listing did not render usable details');
}

export function calculatorOptions({ calculator = false, unit = null } = {}) {
  if (unit !== null) {
    if (typeof unit !== 'string' || !unit.trim() || unit !== unit.trim() || /[\r\n]/.test(unit)) {
      throw new Error('Provide an exact nonempty unit number');
    }
    if (!calculator) throw new Error('--unit requires --calculator');
  }
  return { calculator, unit };
}

export function listingArguments(args) {
  const [url, ...flags] = args;
  let calculator = false;
  let unit = null;
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (flag === '--calculator' && !calculator) {
      calculator = true;
    } else if (flag === '--unit' && unit === null && flags[index + 1]) {
      unit = flags[++index];
    } else {
      throw new Error('Provide a listing URL, optional --calculator and --unit <number>');
    }
  }
  requestedListing(url);
  return { url, ...calculatorOptions({ calculator, unit }) };
}

function requireAvailableUnit(listing, unit) {
  if (listing.id || !listing.building) throw new Error('--unit requires an identity-checked building');
  const units = buildingUnits(listing.building).units;
  const matches = units.filter(candidate => {
    // Zillow's hydration may prefix the number with its display label.
    const number = String(candidate.unitNumber ?? '').replace(/^Unit /, '');
    return number === unit;
  });
  const uniqueIdentity = matches.length === 1 && matches[0].id &&
    units.filter(candidate => candidate.id === matches[0].id).length === 1;
  if (!uniqueIdentity) {
    throw new Error('Requested unit is missing or ambiguous in building evidence');
  }
  return matches[0];
}

async function selectCalculatorUnit(session, requested, { availableUnit, unit, sleep }) {
  const openedMenu = await evaluateJSON(session, readListingPage, ['open_unit_menu']);
  if (openedMenu.error) throw new Error(openedMenu.error);
  await sleep(renderIntervalMs);
  const selected = await evaluateJSON(session, readListingPage, ['select_unit', unit]);
  if (selected.error) throw new Error(selected.error);

  for (let attempt = 0; attempt < renderAttempts; attempt++) {
    const snapshot = await evaluateJSON(session, readListingPage);
    const listing = listingEvidence(snapshot, requested);
    const currentUnit = requireAvailableUnit(listing, unit);
    if (currentUnit.id !== availableUnit.id) throw new Error('Requested unit identity changed');

    const attribution = snapshot.calculatorUnit;
    const matchesUnit = attribution?.selectedUnit === unit && attribution?.estimatedUnit === unit;
    if (snapshot.calculatorText && matchesUnit) return snapshot;
    if (attempt + 1 < renderAttempts) await sleep(renderIntervalMs);
  }
  throw new Error('Calculator did not identify the requested unit in selection and estimate');
}

async function readCalculator(session, requested, initial, { enabled, unit, sleep }) {
  const costs = {
    requested: enabled,
    clicked: false,
    reason: 'not_requested',
    text: null,
    expandedListing: null,
  };
  if (!enabled) return costs;

  const availableUnit = unit === null ? null : requireAvailableUnit(initial.listing, unit);
  let snapshot = initial.snapshot;
  if (!snapshot.calculatorText) {
    const action = await evaluateJSON(session, readListingPage, ['open_calculator']);
    costs.clicked = action.clicked === true;
    costs.reason = action.reason ?? null;
    if (!costs.clicked) {
      if (unit !== null) throw new Error('Requested unit calculator could not be opened');
      return costs;
    }
    await sleep(calculatorRenderDelayMs);
    snapshot = await evaluateJSON(session, readListingPage);
    listingEvidence(snapshot, requested);
  }

  if (unit !== null) {
    snapshot = await selectCalculatorUnit(session, requested, { availableUnit, unit, sleep });
    costs.unit = { requested: unit, id: availableUnit.id, ...snapshot.calculatorUnit };
  }

  costs.expandedListing = listingEvidence(snapshot, requested);
  costs.text = snapshot.calculatorText ?? null;
  costs.reason = costs.text ? null : 'calculator_not_identified';
  return costs;
}

export async function readListing(context, value, {
  calculator = false,
  unit = null,
  sleep = delay,
  page: resumedPage,
  onChallenge,
} = {}) {
  const requested = requestedListing(value);
  calculatorOptions({ calculator, unit });
  if (unit !== null && requested.id) throw new Error('--unit requires a building URL');

  return withOwnedTab(context, async (page, session) => {
    if (!resumedPage) {
      await page.goto(requested.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    const initial = await waitForListing(session, requested, sleep);
    const costs = await readCalculator(session, requested, initial, { enabled: calculator, unit, sleep });

    return {
      checked: new Date().toISOString(),
      requestedUrl: requested.url,
      listing: initial.listing,
      calculator: costs,
      photoScope: 'rendered_images_only',
    };
  }, { page: resumedPage, onChallenge });
}

export default async function ({ context, args }) {
  const { url, ...options } = listingArguments(args);
  const result = await readListing(context, url, options);
  console.log(RESULT_PREFIX + JSON.stringify(result));
}
