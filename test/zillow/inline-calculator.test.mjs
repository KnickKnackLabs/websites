import test from 'node:test';
import assert from 'node:assert/strict';
import { renderedListingSnapshot } from '../../scripts/zillow/listing.mjs';

test('inline calculator uses a unique bounded container, not neighboring listing text', () => {
  const previous = { document: globalThis.document, location: globalThis.location };
  const body = { innerText: 'Rental facts\nNearby homes\nUnrelated rent $9999' };
  const text = 'Cost calculator\nMonthly costs\nRequired Rent $1700\nEstimated total $1700\nMove-in costs\nDeposit $1700';
  const panel = { innerText: text, parentElement: body, querySelector: () => null };
  const heading = { textContent: 'Cost calculator', getClientRects: () => [1], parentElement: panel };
  let anchors = [heading];
  globalThis.location = { href: 'https://www.zillow.com/homedetails/example/123_zpid/' };
  globalThis.document = { body, title: 'Rental', querySelector: () => null,
    querySelectorAll: selector => selector.startsWith('h1,') ? anchors : [] };
  try {
    assert.equal(JSON.parse(renderedListingSnapshot()).calculatorText, text);
    panel.innerText = text + '\nNearby homes\nRent $9999';
    assert.equal(JSON.parse(renderedListingSnapshot()).calculatorText, null);
    panel.innerText = text;
    panel.querySelector = () => ({ href: '/homedetails/other/999_zpid/' });
    assert.equal(JSON.parse(renderedListingSnapshot()).calculatorText, null);
    panel.querySelector = () => null;
    anchors = [heading, { ...heading, parentElement: { ...panel } }];
    assert.equal(JSON.parse(renderedListingSnapshot()).calculatorText, null);
    anchors = [{ ...heading, parentElement: body }];
    assert.equal(JSON.parse(renderedListingSnapshot()).calculatorText, null);
  } finally { globalThis.document = previous.document; globalThis.location = previous.location; }
});
