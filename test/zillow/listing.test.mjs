import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedListing, listingEvidence, readListing, listingArguments } from '../../scripts/zillow/listing.mjs';

const propertyUrl = 'https://www.zillow.com/homedetails/example/123_zpid/';
const otherPropertyUrl = 'https://www.zillow.com/homedetails/other/999_zpid/';
const buildingUrl = 'https://www.zillow.com/b/example-building/AbCd/';
const apartmentsUrl = 'https://www.zillow.com/apartments/chapel-hill-nc/example/5Xhyn3/';
const noWait = async () => {};

function rentalSnapshot(overrides = {}) {
  return {
    url: propertyUrl,
    canonicalUrl: propertyUrl,
    title: 'Example rental',
    text: 'Rental facts\nRent $1700\nTenant pays power\nLaundry hookups\nDogs OK\nNo cats',
    properties: [{ zpid: 123, price: 1700 }],
    photos: [{ url: 'https://photos.zillowstatic.com/example.jpg', alt: 'Kitchen' }],
    ...overrides,
  };
}

// Stub the CDP transport, not the DOM. DOM extraction is exercised separately
// in Chromium against HTML fixtures using the same serialized page reader.
function scriptedBrowser(responses, { detachError = null } = {}) {
  const events = [];
  let nextResponse = 0;
  const page = {
    async goto(url, options) {
      events.push({ action: 'navigate', url, options });
    },
    async close() {
      events.push({ action: 'close' });
    },
  };
  const session = {
    async send() {
      const response = responses[Math.min(nextResponse++, responses.length - 1)];
      return { result: { value: JSON.stringify(response) } };
    },
    async detach() {
      events.push({ action: 'detach' });
      if (detachError) throw detachError;
    },
  };
  const context = {
    async newPage() { return page; },
    async newCDPSession() { return session; },
  };
  return { context, events };
}

function assertTabWasCleanedUp(browser) {
  assert.deepEqual(browser.events.slice(-2), [{ action: 'detach' }, { action: 'close' }]);
}

test('individual listing preserves narrative conflicts after verifying hydration identity', () => {
  const snapshot = rentalSnapshot();
  const evidence = listingEvidence(snapshot, requestedListing(propertyUrl));
  assert.equal(evidence.id, '123');
  assert.equal(evidence.text, snapshot.text);
});

for (const url of [buildingUrl, apartmentsUrl]) {
  test(`building evidence accepts ${new URL(url).pathname} without individual hydration`, () => {
    const sections = { Policies: ['Policies\nCats allowed'] };
    const snapshot = rentalSnapshot({
      url,
      canonicalUrl: url,
      text: 'Available units',
      properties: [],
      sections,
    });
    const evidence = listingEvidence(snapshot, requestedListing(url));
    assert.equal(evidence.id, null);
    assert.deepEqual(evidence.sections, sections);
  });
}

const invalidUrls = {
  'foreign host': 'https://evil.test/homedetails/example/123_zpid/',
  'home page': 'https://www.zillow.com/',
  'search page': 'https://www.zillow.com/homes/',
  'incomplete building path': 'https://www.zillow.com/b/',
  'apartment directory': 'https://www.zillow.com/apartments/',
  'apartment path without identity': 'https://www.zillow.com/apartments/city/example/',
};
for (const [scenario, url] of Object.entries(invalidUrls)) {
  test(`listing URL rejects ${scenario}`, () => {
    assert.throws(() => requestedListing(url));
  });
}

const invalidEvidence = {
  'redirect to another property': { url: otherPropertyUrl },
  'canonical URL of another property': { canonicalUrl: otherPropertyUrl },
  'hydration for another property': { properties: [{ zpid: 999 }] },
  'generic page content': { text: 'Welcome to Zillow' },
  'malformed property evidence': { properties: {} },
  'missing hydration': { properties: [] },
  'hydration without identity': { properties: [{ price: 1700 }] },
};
for (const [scenario, overrides] of Object.entries(invalidEvidence)) {
  test(`listing evidence rejects ${scenario}`, () => {
    const snapshot = rentalSnapshot(overrides);
    assert.throws(() => listingEvidence(snapshot, requestedListing(propertyUrl)));
  });
}

test('building evidence rejects a redirect to another building', () => {
  const snapshot = rentalSnapshot({
    url: apartmentsUrl.replace('5Xhyn3', 'Other'),
    canonicalUrl: apartmentsUrl,
    text: 'Available units',
    properties: [],
  });
  assert.throws(() => listingEvidence(snapshot, requestedListing(apartmentsUrl)), /differs/);
});

test('reader waits for loading and does not click a calculator by default', async () => {
  const browser = scriptedBrowser([{ url: propertyUrl, text: 'loading' }, rentalSnapshot()]);
  const waits = [];
  const result = await readListing(browser.context, propertyUrl, {
    sleep: async milliseconds => waits.push(milliseconds),
  });

  assert.equal(result.listing.properties[0].price, 1700);
  assert.deepEqual(result.calculator, {
    requested: false,
    clicked: false,
    reason: 'not_requested',
    text: null,
    expandedListing: null,
  });
  assert.equal(result.photoScope, 'rendered_images_only');
  assert.deepEqual(waits, [1000]);
  assertTabWasCleanedUp(browser);
});

test('calculator keeps original and expanded evidence separate without all-in inference', async () => {
  const expanded = rentalSnapshot({
    text: 'Rental facts\nCost calculator\nTotal monthly $1700\nTenant pays power',
    calculatorText: 'Total monthly $1700',
  });
  const browser = scriptedBrowser([rentalSnapshot(), { clicked: true }, expanded]);
  const result = await readListing(browser.context, propertyUrl, { calculator: true, sleep: noWait });

  assert.equal(result.calculator.clicked, true);
  assert.equal(result.calculator.text, expanded.calculatorText);
  assert.equal(result.listing.text, rentalSnapshot().text);
  assert.match(result.calculator.expandedListing.text, /Tenant pays power/);
  assert.equal(result.allInRent, undefined);
});

for (const reason of ['not_available', 'ambiguous']) {
  test(`calculator reports ${reason} without clicking`, async () => {
    const browser = scriptedBrowser([rentalSnapshot(), { clicked: false, reason }]);
    const result = await readListing(browser.context, propertyUrl, { calculator: true });
    assert.equal(result.calculator.reason, reason);
    assert.equal(result.calculator.text, null);
  });
}

test('a calculator click alone does not claim an identified panel', async () => {
  const browser = scriptedBrowser([rentalSnapshot(), { clicked: true }, rentalSnapshot()]);
  const result = await readListing(browser.context, propertyUrl, { calculator: true, sleep: noWait });
  assert.equal(result.calculator.reason, 'calculator_not_identified');
});

test('pre-rendered calculator is read without an ambiguous open-control click', async () => {
  const snapshot = rentalSnapshot({ calculatorText: 'Monthly costs $1700' });
  const browser = scriptedBrowser([snapshot]);
  const result = await readListing(browser.context, propertyUrl, { calculator: true });
  assert.equal(result.calculator.clicked, false);
  assert.equal(result.calculator.text, snapshot.calculatorText);
});

function unitSnapshot(overrides = {}) {
  return rentalSnapshot({
    url: apartmentsUrl,
    canonicalUrl: apartmentsUrl,
    properties: [],
    text: 'Available units\nMonthly costs\nMove-in costs',
    calculatorText: 'Estimated total for Unit 42\nMonthly costs $1760\nMove-in costs unknown',
    building: {
      bdpUrl: new URL(apartmentsUrl).pathname,
      floorPlans: [{ units: [{ zpid: 123, unitNumber: 'Unit 42' }] }],
      rentalUnitsSummary: { availableUnitCount: 1 },
    },
    ...overrides,
  });
}

test('unit calculator verifies provider identity and both selected and estimated unit', async () => {
  const selected = unitSnapshot({ calculatorUnit: { selectedUnit: '42', estimatedUnit: '42' } });
  const browser = scriptedBrowser([unitSnapshot(), {}, {}, selected]);
  const result = await readListing(browser.context, apartmentsUrl, {
    calculator: true, unit: '42', sleep: noWait,
  });
  assert.deepEqual(result.calculator.unit, {
    requested: '42', id: 'zpid:123', selectedUnit: '42', estimatedUnit: '42',
  });
  assert.equal(result.calculator.text, selected.calculatorText);
  assertTabWasCleanedUp(browser);
});

test('unit calculator refuses mismatched estimate even when the selector matches', async () => {
  const wrongEstimate = unitSnapshot({ calculatorUnit: { selectedUnit: '42', estimatedUnit: '420' } });
  const browser = scriptedBrowser([unitSnapshot(), {}, {}, wrongEstimate]);
  await assert.rejects(readListing(browser.context, apartmentsUrl, {
    calculator: true, unit: '42', sleep: noWait,
  }), /selection and estimate/);
  assertTabWasCleanedUp(browser);
});

test('unknown building unit is rejected before any calculator action', async () => {
  const browser = scriptedBrowser([unitSnapshot()]);
  await assert.rejects(readListing(browser.context, apartmentsUrl, {
    calculator: true, unit: '999', sleep: noWait,
  }), /missing or ambiguous/);
});

test('duplicate hydrated unit identity cannot establish calculator attribution', async () => {
  const snapshot = unitSnapshot();
  snapshot.building.floorPlans[0].units.push({ zpid: 123, unitNumber: 'Unit 420' });
  const browser = scriptedBrowser([snapshot]);
  await assert.rejects(readListing(browser.context, apartmentsUrl, {
    calculator: true, unit: '42', sleep: noWait,
  }), /missing or ambiguous/);
});

test('unit calculator rejects identity drift after selection', async () => {
  const changed = unitSnapshot();
  changed.building.floorPlans[0].units[0].zpid = 999;
  const browser = scriptedBrowser([unitSnapshot(), {}, {}, changed]);
  await assert.rejects(readListing(browser.context, apartmentsUrl, {
    calculator: true, unit: '42', sleep: noWait,
  }), /identity changed/);
});

test('unit selection challenge parks for human help rather than failing as a missing menu', async () => {
  const browser = scriptedBrowser([unitSnapshot(), {
    error: 'Unique owned calculator panel is missing',
    url: apartmentsUrl, text: 'Press and hold to verify',
  }]);
  const result = await readListing(browser.context, apartmentsUrl, {
    calculator: true, unit: '42', sleep: noWait,
    onChallenge: async () => ({ status: 'needs_human' }),
  });
  assert.equal(result.status, 'needs_human');
  assert.equal(browser.events.some(event => event.action === 'close'), false);
});

test('unit arguments require calculator and preserve exact unit number', () => {
  assert.deepEqual(listingArguments([apartmentsUrl, '--unit', '42', '--calculator']), {
    url: apartmentsUrl, unit: '42', calculator: true,
  });
  assert.throws(() => listingArguments([apartmentsUrl, '--unit', '42']), /requires/);
  assert.throws(() => listingArguments([apartmentsUrl, '--calculator', '--unit', '']), /Provide/);
});

const failedReads = {
  'challenge before reading': [rentalSnapshot({ text: 'CAPTCHA Rental facts' })],
  'mismatched hydrated identity': [rentalSnapshot({ properties: [{ zpid: 999 }] })],
  'challenge after calculator click': [rentalSnapshot(), { clicked: true }, rentalSnapshot({ text: 'Press and hold' })],
  'redirect after calculator click': [rentalSnapshot(), { clicked: true }, rentalSnapshot({ url: otherPropertyUrl })],
};
for (const [scenario, responses] of Object.entries(failedReads)) {
  test(`reader cleans up and rejects ${scenario}`, async () => {
    const browser = scriptedBrowser(responses);
    await assert.rejects(readListing(browser.context, propertyUrl, { calculator: true, sleep: noWait }));
    assertTabWasCleanedUp(browser);
  });
}

test('reader does not return success when CDP detachment fails', async () => {
  const browser = scriptedBrowser([rentalSnapshot()], { detachError: new Error('detach failed') });
  await assert.rejects(readListing(browser.context, propertyUrl), /cleanup/);
  assertTabWasCleanedUp(browser);
});

test('reader gives up after bounded render attempts', async () => {
  const browser = scriptedBrowser([{ url: propertyUrl, text: 'loading' }]);
  await assert.rejects(readListing(browser.context, propertyUrl, { sleep: noWait }), /did not render/);
  assertTabWasCleanedUp(browser);
});
