import assert from 'node:assert/strict';
import { evaluateJSON, withOwnedTab } from '../../../scripts/zillow/browser.mjs';
import { readListingPage } from '../../../scripts/zillow/listing-page.mjs';
import { propertyMedia } from '../../../scripts/zillow/property-media.mjs';

const calculatorHtml = `
  <section>
    <h2>Cost calculator</h2>
    <h3>Monthly costs</h3><p>Required rent $1700</p>
    <h3>Move-in costs</h3><p>Deposit $1700</p>
  </section>
`;
const unrelatedListingHtml = '<aside><h2>Nearby homes</h2><p>Other property rent $9999</p></aside>';

export default async function ({ context }) {
  const passedScenarios = [];

  await withOwnedTab(context, async (page, session) => {
    // Synthetic DOM tests must not fetch image URLs or touch Zillow.
    await page.route('**/*', route => route.abort());
    const { frameTree } = await session.send('Page.getFrameTree');

    async function render(html) {
      await session.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
      return evaluateJSON(session, readListingPage);
    }

    const propertyGallery = [{ url: 'https://photos.zillowstatic.com/owned-room.jpg', caption: 'Owned room' }];
    const hydration = { props: { pageProps: { componentProps: {
      gdpClientCache: JSON.stringify({ detail: { property: { zpid: 123, responsivePhotos: propertyGallery } } }),
      initialReduxState: { nearbyProperties: [{ responsivePhotos: [{ url: 'https://example.test/neighbor.jpg' }] }] },
    } } } };
    const hydratedPage = await render(`
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(hydration)}</script>
      <h1>Example property</h1>
      <img src="https://photos.zillowstatic.com/room.jpg" alt="Kitchen">
      <img src="https://example.test/tracker.gif">
    `);
    assert.equal(hydratedPage.properties[0].zpid, 123);
    assert.deepEqual(hydratedPage.photos, [{
      url: 'https://photos.zillowstatic.com/room.jpg',
      alt: 'Kitchen',
    }]);
    passedScenarios.push('hydration and Zillow photo filtering');
    const propertyGalleryRead = propertyMedia({ ...hydratedPage, id: '123' });
    assert.deepEqual(propertyGalleryRead.gallery.items, propertyGallery);
    assert.equal(JSON.stringify(propertyGalleryRead).includes('neighbor.jpg'), false);
    passedScenarios.push('property media uses hydration rather than global rendered images');

    const building = {
      bdpUrl: '/apartments/example-city/example-building/AbCd/',
      lotId: 'building-1',
      galleryPhotos: propertyGallery,
      floorPlans: [{
        name: 'One bedroom', photos: [{ url: 'https://photos.zillowstatic.com/owned-layout.jpg' }],
        units: [{ zpid: '123', unitNumber: 'Unit 124', galleryPhotos: propertyGallery }],
      }],
      rentalUnitsSummary: { availableUnitCount: 1 },
    };
    const buildingHydration = {
      props: { pageProps: { componentProps: { initialReduxState: {
        gdp: { building },
        nearbyProperties: [{ zpid: '999' }],
        floorplanLightbox: { units: [{ zpid: 'dummy' }] },
      } } } },
    };
    const buildingPage = await render(`
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(buildingHydration)}</script>
      <h1>Example building</h1><h2>Available units</h2>
    `);
    assert.deepEqual(buildingPage.building, building);
    assert.deepEqual(buildingPage.properties, []);
    passedScenarios.push('building hydration uses its own Redux owner');
    const buildingGalleryRead = propertyMedia({ ...buildingPage, id: null });
    assert.deepEqual(buildingGalleryRead.gallery.items, propertyGallery);
    assert.equal(buildingGalleryRead.units[0].id, 'zpid:123');
    assert.equal(buildingGalleryRead.floorPlans[0].images.items[0].url,
      'https://photos.zillowstatic.com/owned-layout.jpg');
    assert.equal(JSON.stringify(buildingGalleryRead).includes('dummy'), false);
    passedScenarios.push('building media excludes nearby and lightbox owners');

    const inline = await render(calculatorHtml + unrelatedListingHtml);
    assert.match(inline.calculatorText, /Required rent \$1700/);
    assert.doesNotMatch(inline.calculatorText, /9999/);
    passedScenarios.push('inline calculator excludes neighboring properties');

    const contaminated = await render(`
      <section>
        <h2>Cost calculator</h2><p>Monthly costs</p>
        ${unrelatedListingHtml}
        <p>Move-in costs</p>
      </section>
    `);
    assert.equal(contaminated.calculatorText, null);
    passedScenarios.push('calculator rejects mixed-property container');

    const linkedProperty = await render(calculatorHtml.replace('</section>',
      '<a href="/apartments/city/neighbor/id/">Another property</a></section>'));
    assert.equal(linkedProperty.calculatorText, null);
    passedScenarios.push('calculator rejects linked apartment property');

    const ambiguous = await render(calculatorHtml + calculatorHtml);
    assert.equal(ambiguous.calculatorText, null);
    passedScenarios.push('multiple calculator panels remain ambiguous');

    const unitCalculatorHtml = `
      <div data-subapp-name="rental-costs-and-fees-sub-app" style="display:contents">
        <h2>Cost calculator</h2>
        <button data-testid="unit-selection-display-name" aria-controls="unit-menu"
          onclick="document.getElementById('unit-menu').hidden=false">2 units available</button>
        <p id="unit-estimate">Estimated total</p>
        <h3>Monthly costs</h3><p>Base rent $1600</p>
        <h3>Move-in costs</h3><p>No required one-time fees provided</p>
        <a href="/homedetails/example/123_zpid/">See unit details</a>
      </div>
      <div id="unit-menu" hidden>
        <button role="menuitem" onclick="
          document.querySelector('[data-testid=unit-selection-display-name]').textContent='Unit 42';
          document.getElementById('unit-estimate').textContent='Estimated total for Unit 42';
          document.getElementById('unit-menu').hidden=true;
        "><span>Unit 42</span><span>$1600</span></button>
        <button role="menuitem"><span>Unit 420</span></button>
      </div>
      <aside><button role="menuitem"><span>Unit 42</span></button></aside>
    `;
    const ownedPanel = await render(unitCalculatorHtml + unrelatedListingHtml);
    assert.match(ownedPanel.calculatorText, /See unit details/);
    assert.doesNotMatch(ownedPanel.calculatorText, /9999/);
    await evaluateJSON(session, readListingPage, ['open_unit_menu']);
    await evaluateJSON(session, readListingPage, ['select_unit', '42']);
    const selectedUnit = await evaluateJSON(session, readListingPage);
    assert.deepEqual(selectedUnit.calculatorUnit, { selectedUnit: '42', estimatedUnit: '42' });
    passedScenarios.push('owned calculator selects exact unit through linked portal menu');

    await render(unitCalculatorHtml.replace('aria-controls="unit-menu"', 'aria-controls="missing"'));
    const missingMenu = await evaluateJSON(session, readListingPage, ['select_unit', '42']);
    assert.match(missingMenu.error, /menu is missing/);
    passedScenarios.push('unit selection rejects unlinked menu');

    await render(unitCalculatorHtml.replace('<span>Unit 420</span>', '<span>Unit 42</span>'));
    await evaluateJSON(session, readListingPage, ['open_unit_menu']);
    const duplicateChoices = await evaluateJSON(session, readListingPage, ['select_unit', '42']);
    assert.match(duplicateChoices.error, /ambiguous/);
    passedScenarios.push('unit selection rejects duplicate exact choices');

    const duplicateOwners = await render(unitCalculatorHtml + unitCalculatorHtml);
    assert.equal(duplicateOwners.calculatorText, null);
    const missingOwner = await evaluateJSON(session, readListingPage, ['open_unit_menu']);
    assert.match(missingOwner.error, /panel is missing/);
    passedScenarios.push('unit calculator rejects duplicate owners');

    const dialog = await render(`
      <div role="dialog" aria-label="Cost calculator">Monthly costs $1700</div>
    `);
    assert.equal(dialog.calculatorText, 'Monthly costs $1700');
    passedScenarios.push('dialog calculator');

    const policies = await render(`
      <section><h2>Policies</h2><h3>Pets</h3><p>Cats allowed. Monthly cat rent $25</p></section>
      ${unrelatedListingHtml}
    `);
    assert.match(policies.sections.Policies[0], /Cats allowed/);
    assert.doesNotMatch(policies.sections.Policies[0], /9999/);
    passedScenarios.push('scoped policies preserve nested facts');

    const mixedSections = await render(`
      <div><h2>Policies</h2><p>Cats allowed</p><h2>Nearby places</h2><p>Not property policy</p></div>
    `);
    assert.deepEqual(mixedSections.sections, {});
    passedScenarios.push('section rejects peer headings');

    await render(`
      <button onclick="document.querySelector('#clicked').textContent='clicked'">Cost calculator</button>
      <button hidden>Cost calculator</button><p id="clicked">not clicked</p>
    `);
    const action = await evaluateJSON(session, readListingPage, ['open_calculator']);
    assert.equal(action.clicked, true);
    const clicked = await evaluateJSON(session, readListingPage);
    assert.match(clicked.text, /\nclicked$/);
    passedScenarios.push('calculator click ignores hidden controls');

    await render('<button>Cost calculator</button><button>Cost calculator</button>');
    const duplicateControls = await evaluateJSON(session, readListingPage, ['open_calculator']);
    assert.equal(duplicateControls.clicked, false);
    assert.equal(duplicateControls.reason, 'ambiguous');
    passedScenarios.push('calculator click rejects ambiguous controls');
  });

  console.log(JSON.stringify({ passedScenarios }));
}
