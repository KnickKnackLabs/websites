import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedListing, listingEvidence, readListing, renderedListingSnapshot, openCalculator } from '../../scripts/zillow/listing.mjs';

const url = 'https://www.zillow.com/homedetails/example/123_zpid/';
const snapshot = (extra = {}) => ({ url, canonicalUrl: url, title: 'Example rental', text: 'Rental facts\nRent $1700\nTenant pays power\nLaundry hookups\nDogs OK\nNo cats', properties: [{ zpid: 123, price: 1700 }], photos: [{ url: 'https://photos.zillowstatic.com/example.jpg', alt: 'Kitchen' }], ...extra });
function browser(values, { detachFails = false } = {}) {
  const events = [];
  let index = 0;
  const context = {
    newPage: async () => ({ goto: async (value, options) => events.push(['goto', value, options]), close: async () => events.push(['close']) }),
    newCDPSession: async () => ({ send: async () => ({ result: { value: JSON.stringify(values[Math.min(index++, values.length - 1)]) } }), detach: async () => { events.push(['detach']); if (detachFails) throw new Error('detach failed'); } }),
  };
  return { context, events };
}

test('listing URL and evidence require matching identity, preserve raw conflicts', () => {
  const requested = requestedListing(url);
  assert.equal(requested.id, '123');
  assert.equal(listingEvidence(snapshot(), requested).text, snapshot().text);
  const building = 'https://www.zillow.com/b/example-building/AbCd/';
  assert.equal(requestedListing(building).id, null);
  assert.equal(listingEvidence(snapshot({ url: building, canonicalUrl: building, properties: [] }), requestedListing(building)).id, null);
  for (const bad of ['https://evil.test/homedetails/123_zpid/', 'https://www.zillow.com/', 'https://www.zillow.com/homes/', 'https://www.zillow.com/b/']) assert.throws(() => requestedListing(bad));
  for (const bad of [snapshot({ url: url.replace('123_', '124_') }), snapshot({ canonicalUrl: url.replace('123_', '124_') }), snapshot({ properties: [{ zpid: 999 }] }), snapshot({ text: 'Welcome to Zillow' }), snapshot({ properties: {} }), snapshot({ properties: [] }), snapshot({ properties: [{ price: 1700 }] })]) assert.throws(() => listingEvidence(bad, requested));
});

test('listing polls, owns its tab and leaves calculator untouched by default', async () => {
  const mock = browser([{ url, text: 'loading' }, snapshot()]);
  const waits = [];
  const result = await readListing(mock.context, url, { sleep: async ms => waits.push(ms) });
  assert.equal(result.listing.properties[0].price, 1700);
  assert.deepEqual(result.calculator, { requested: false, clicked: false, reason: 'not_requested', text: null, expandedListing: null });
  assert.equal(result.photoScope, 'rendered_images_only');
  assert.deepEqual(waits, [1000]);
  assert.deepEqual(mock.events.slice(-2), [['detach'], ['close']]);
});

test('optional calculator preserves separate original/expanded evidence without all-in inference', async () => {
  const mock = browser([snapshot(), { clicked: true }, snapshot({ text: 'Rental facts\nCost calculator\nTotal monthly $1700\nTenant pays power', calculatorText: 'Total monthly $1700' })]);
  const result = await readListing(mock.context, url, { calculator: true, sleep: async () => {} });
  assert.equal(result.calculator.clicked, true);
  assert.equal(result.calculator.text, 'Total monthly $1700');
  assert.equal(result.listing.text, snapshot().text);
  assert.match(result.calculator.expandedListing.text, /Tenant pays power/);
  assert.equal(result.allInRent, undefined);
});

test('calculator absence/ambiguity and unidentified panel remain explicit', async () => {
  for (const reason of ['not_available', 'ambiguous']) {
    const result = await readListing(browser([snapshot(), { clicked: false, reason }]).context, url, { calculator: true });
    assert.equal(result.calculator.reason, reason);
    assert.equal(result.calculator.text, null);
  }
  const result = await readListing(browser([snapshot(), { clicked: true }, snapshot()]).context, url, { calculator: true, sleep: async () => {} });
  assert.equal(result.calculator.reason, 'calculator_not_identified');
});

test('challenge before/after click, mismatched hydration and cleanup failure emit no success', async () => {
  for (const values of [[snapshot({ text: 'CAPTCHA Rental facts' })], [snapshot({ properties: [{ zpid: 999 }] })], [snapshot(), { clicked: true }, snapshot({ text: 'Press and hold' })], [snapshot(), { clicked: true }, snapshot({ url: url.replace('123_', '124_') })]]) {
    const mock = browser(values);
    await assert.rejects(readListing(mock.context, url, { calculator: true, sleep: async () => {} }));
    assert.deepEqual(mock.events.slice(-2), [['detach'], ['close']]);
  }
  await assert.rejects(readListing(browser([snapshot()], { detachFails: true }).context, url), /cleanup/);
  await assert.rejects(readListing(browser([{ url, text: 'loading' }]).context, url, { sleep: async () => {} }), /did not render/);
});

test('browser snapshot extracts known hydration and rendered photos; calculator click is exact and visible', () => {
  const oldDocument = globalThis.document;
  const oldLocation = globalThis.location;
  let clicks = 0;
  const button = { textContent: 'Cost calculator', getClientRects: () => [1], click: () => clicks++ };
  globalThis.location = { href: url };
  globalThis.document = {
    title: 'Rental', body: { innerText: 'Rental facts' },
    querySelector: selector => selector === '#__NEXT_DATA__' ? { textContent: JSON.stringify({ props: { pageProps: { componentProps: { gdpClientCache: JSON.stringify({ detail: { property: { zpid: 123 } } }) } } } }) } : null,
    querySelectorAll: selector => selector === 'img' ? [{ src: 'https://photos.zillowstatic.com/a.jpg', alt: 'Room' }, { src: 'https://example.test/track.gif' }] : selector === 'button,a' ? [button] : [],
  };
  try {
    const value = JSON.parse(renderedListingSnapshot());
    assert.equal(value.properties[0].zpid, 123);
    assert.deepEqual(value.photos, [{ url: 'https://photos.zillowstatic.com/a.jpg', alt: 'Room' }]);
    assert.equal(JSON.parse(openCalculator()).clicked, true);
    assert.equal(clicks, 1);
    globalThis.document.querySelectorAll = () => [button, button];
    assert.equal(JSON.parse(openCalculator()).reason, 'ambiguous');
    assert.equal(clicks, 1);
  } finally { globalThis.document = oldDocument; globalThis.location = oldLocation; }
});
