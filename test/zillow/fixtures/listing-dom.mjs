import assert from 'node:assert/strict';
import { evaluateJSON, withOwnedTab } from '../../../scripts/zillow/browser.mjs';
import { readListingPage } from '../../../scripts/zillow/listing-page.mjs';

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

    const hydration = { props: { pageProps: { componentProps: {
      gdpClientCache: JSON.stringify({ detail: { property: { zpid: 123 } } }),
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

    const building = {
      bdpUrl: '/apartments/example-city/example-building/AbCd/',
      lotId: 'building-1',
      floorPlans: [{ name: 'One bedroom', units: [{ zpid: '123', unitNumber: 'Unit 124' }] }],
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
