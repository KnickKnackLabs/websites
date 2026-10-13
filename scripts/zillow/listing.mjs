import { zillowUrl, evaluateJSON, withOwnedTab, delay } from './browser.mjs';
import { RESULT_PREFIX } from './task.mjs';

export function requestedListing(value) {
  const url = zillowUrl(value);
  const id = url.pathname.match(/\/(\d+)_zpid\/?$/)?.[1];
  if (!id && !/^\/b\/[^/]+\/[^/]+\/?$/.test(url.pathname)) throw new Error('Expected a Zillow homedetails or building detail URL');
  if (id && !url.pathname.startsWith('/homedetails/')) throw new Error('Expected a Zillow homedetails URL');
  return { url: url.href, id: id ?? null, path: url.pathname.replace(/\/$/, '') };
}

// Browser realm: collect source evidence, not inferred cost/pet/lease answers.
export function renderedListingSnapshot() {
  const node = document.querySelector('#__NEXT_DATA__');
  const props = node ? JSON.parse(node.textContent)?.props?.pageProps : null;
  const properties = [];
  if (props?.property) properties.push(props.property);
  const cache = props?.componentProps?.gdpClientCache ?? props?.gdpClientCache;
  if (cache) {
    const parsed = typeof cache === 'string' ? JSON.parse(cache) : cache;
    for (const value of Object.values(parsed)) {
      if (value?.property) properties.push(value.property);
    }
  }
  const photos = [...document.querySelectorAll('img')]
    .filter(img => { try { return new URL(img.currentSrc || img.src).hostname === 'photos.zillowstatic.com'; } catch { return false; } })
    .map(img => ({ url: img.currentSrc || img.src, alt: img.alt || null }));
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    .filter(el => /cost calculator/i.test((el.getAttribute('aria-label') || '') + ' ' + el.textContent));
  // Inline calculators: accept only a small, uniquely identified DOM container.
  // Do not slice whole-page text, which may include other properties and repeated panels.
  const inline = new Set();
  for (const anchor of document.querySelectorAll('h1,h2,h3,h4,[role="heading"],button,a')) {
    if (anchor.textContent.trim() !== 'Cost calculator' || !anchor.getClientRects().length) continue;
    let container = anchor.parentElement;
    for (let depth = 0; container && depth < 6; depth++, container = container.parentElement) {
      if (container === document.body) break;
      const text = container.innerText || '';
      if (text.length > 12000 || /rental facts|what.s special|nearby homes|similar homes|available units/i.test(text)) break;
      if (/monthly costs/i.test(text) && /move-in costs/i.test(text)) {
        if (!container.querySelector('a[href*="/homedetails/"],a[href*="/b/"]')) inline.add(container);
        break;
      }
    }
  }
  const calculatorText = dialogs.length === 1 ? dialogs[0].innerText
    : dialogs.length === 0 && inline.size === 1 ? [...inline][0].innerText : null;
  return JSON.stringify({ url: location.href, canonicalUrl: document.querySelector('link[rel="canonical"]')?.href ?? null,
    title: document.title, text: document.body.innerText, properties,
    photos, ogImage: document.querySelector('meta[property="og:image"]')?.content ?? null,
    calculatorText });
}

export function listingEvidence(snapshot, requested) {
  const current = requestedListing(snapshot.url);
  if (requested.id ? current.id !== requested.id : current.path !== requested.path) throw new Error('Rendered listing differs from requested listing');
  if (snapshot.canonicalUrl) {
    const canonical = requestedListing(snapshot.canonicalUrl);
    if (requested.id ? canonical.id !== requested.id : canonical.path !== requested.path) throw new Error('Canonical listing differs from requested listing');
  }
  const properties = snapshot.properties ?? [];
  if (!Array.isArray(properties)) throw new Error('Invalid listing property evidence');
  if (requested.id) {
    const ids = properties.filter(property => property?.zpid != null).map(property => String(property.zpid));
    if (!ids.length) throw new Error('Hydrated listing identity is missing; identity not established');
    if (ids.some(id => id !== requested.id)) throw new Error('Hydrated listing identity differs from requested listing');
  }
  // URL identity alone is insufficient: require rendered listing-specific content.
  if (typeof snapshot.text !== 'string' || !/rental facts|what.s special|rental listing|available units|building overview|building details/i.test(snapshot.text)) throw new Error('Listing did not render usable details');
  return { url: current.url, canonicalUrl: snapshot.canonicalUrl ?? null, id: current.id,
    title: snapshot.title ?? null, text: snapshot.text, properties,
    photos: snapshot.photos ?? [], ogImage: snapshot.ogImage ?? null };
}

export function openCalculator() {
  const visible = el => el.getClientRects().length > 0;
  const candidates = [...document.querySelectorAll('button,a')]
    .filter(el => visible(el) && el.textContent.trim() === 'Cost calculator');
  if (candidates.length !== 1) return JSON.stringify({ clicked: false, reason: candidates.length ? 'ambiguous' : 'not_available', text: document.body.innerText });
  candidates[0].click();
  return JSON.stringify({ clicked: true, reason: null, text: document.body.innerText });
}

export async function readListing(context, value, { calculator = false, sleep = delay, page: resumedPage, onChallenge } = {}) {
  const requested = requestedListing(value);
  return withOwnedTab(context, async (page, session) => {
    if (!resumedPage) await page.goto(requested.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    let listing;
    for (let attempt = 0; attempt < 15; attempt++) {
      const snapshot = await evaluateJSON(session, renderedListingSnapshot);
      // Only wait on loading; identity mismatches must not be concealed by retries.
      if (/rental facts|what.s special|rental listing|available units|building overview|building details/i.test(snapshot.text ?? '')) {
        listing = listingEvidence(snapshot, requested);
        break;
      }
      if (attempt < 14) await sleep(1000);
    }
    if (!listing) throw new Error('Listing did not render usable details');
    let costs = { requested: calculator, clicked: false, reason: 'not_requested', text: null, expandedListing: null };
    if (calculator) {
      const action = await evaluateJSON(session, openCalculator);
      costs = { requested: true, clicked: action.clicked === true, reason: action.reason ?? null, text: null, expandedListing: null };
      if (costs.clicked) {
        await sleep(2000);
        const expanded = await evaluateJSON(session, renderedListingSnapshot);
        costs.expandedListing = listingEvidence(expanded, requested);
        costs.text = expanded.calculatorText ?? null;
        costs.reason = costs.text ? null : 'calculator_not_identified';
      }
    }
    return { checked: new Date().toISOString(), requestedUrl: requested.url, listing, calculator: costs, photoScope: 'rendered_images_only' };
  }, { page: resumedPage, onChallenge });
}

export default async function ({ context, args }) {
  if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== '--calculator')) throw new Error('Provide a listing URL and optional --calculator');
  const result = await readListing(context, args[0], { calculator: args[1] === '--calculator' });
  console.log(RESULT_PREFIX + JSON.stringify(result));
}
