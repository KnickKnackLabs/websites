// This function is serialized into the page through CDP. Keep its dependencies
// inside the function: imports and outer-scope bindings do not cross that boundary.
export function readListingPage(action = 'snapshot', requestedUnit = null) {
  const headingSelector = 'h1,h2,h3,h4,[role="heading"]';
  const propertyLinkSelector = 'a[href*="/homedetails/"],a[href*="/b/"],a[href*="/apartments/"]';

  function isVisible(element) {
    return element.getClientRects().length > 0;
  }

  function readPageProps() {
    const hydration = document.querySelector('#__NEXT_DATA__');
    if (!hydration) return null;
    return JSON.parse(hydration.textContent)?.props?.pageProps ?? null;
  }

  function readHydratedBuilding(pageProps) {
    // This is the building's own data owner. Do not recursively search Redux:
    // nearby properties and lightbox defaults also contain unit-like objects.
    return pageProps?.componentProps?.initialReduxState?.gdp?.building ?? null;
  }

  function readHydratedProperties(pageProps) {
    const properties = [];
    if (pageProps?.property) properties.push(pageProps.property);

    const clientCache = pageProps?.componentProps?.gdpClientCache ?? pageProps?.gdpClientCache;
    if (!clientCache) return properties;

    const entries = typeof clientCache === 'string' ? JSON.parse(clientCache) : clientCache;
    for (const entry of Object.values(entries)) {
      if (entry?.property) properties.push(entry.property);
    }
    return properties;
  }

  function readRenderedPhotos() {
    const photos = [];
    for (const image of document.querySelectorAll('img')) {
      const url = image.currentSrc || image.src;
      try {
        if (new URL(url).hostname !== 'photos.zillowstatic.com') continue;
      } catch {
        continue;
      }
      photos.push({ url, alt: image.alt || null });
    }
    return photos;
  }

  function calculatorPanels() {
    // The provider's ownership wrapper uses display:contents and has no rect.
    return [...document.querySelectorAll('[data-subapp-name="rental-costs-and-fees-sub-app"]')]
      .filter(panel => isVisible(panel) || [...panel.querySelectorAll('*')].some(isVisible));
  }

  function ownedCalculatorPanel() {
    const panels = calculatorPanels();
    return panels.length === 1 ? panels[0] : null;
  }

  function readCalculatorUnit() {
    const panel = ownedCalculatorPanel();
    if (!panel) return null;
    const triggers = [...panel.querySelectorAll('button[data-testid="unit-selection-display-name"]')]
      .filter(isVisible);
    const selectedLabel = triggers.length === 1 ? triggers[0].textContent.trim() : null;
    const estimates = (panel.innerText || '').match(/^Estimated total for Unit .+$/gm) ?? [];
    return {
      selectedUnit: selectedLabel?.startsWith('Unit ') ? selectedLabel.slice(5).trim() : null,
      estimatedUnit: estimates.length === 1 ? estimates[0].slice('Estimated total for Unit '.length).trim() : null,
    };
  }

  function unitSelection(action) {
    const panel = ownedCalculatorPanel();
    if (!panel) throw new Error('Unique owned calculator panel is missing');
    const triggers = [...panel.querySelectorAll('button[data-testid="unit-selection-display-name"]')]
      .filter(isVisible);
    if (triggers.length !== 1) throw new Error('Unique calculator unit selector is missing');
    const trigger = triggers[0];
    if (action === 'open_unit_menu') {
      trigger.click();
    } else {
      const menuId = trigger.getAttribute('aria-controls');
      const menu = menuId ? document.getElementById(menuId) : null;
      if (!menu || !isVisible(menu)) throw new Error('Calculator unit menu is missing');
      const choices = [...menu.querySelectorAll('button[role="menuitem"]')].filter(choice => {
        return isVisible(choice) && [...choice.querySelectorAll('span')]
          .some(label => label.textContent.trim() === `Unit ${requestedUnit}`);
      });
      if (choices.length !== 1) throw new Error('Requested calculator unit is missing or ambiguous');
      choices[0].click();
    }
    return { url: location.href, title: document.title, text: document.body.innerText };
  }

  function readCalculatorText() {
    const ownedPanels = calculatorPanels();
    if (ownedPanels.length > 1) return null;
    if (ownedPanels.length === 1) {
      const text = ownedPanels[0].innerText || '';
      return /monthly costs/i.test(text) && /move-in costs/i.test(text) ? text : null;
    }

    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(dialog => {
      const label = dialog.getAttribute('aria-label') || '';
      return /cost calculator/i.test(label + ' ' + dialog.textContent);
    });
    if (dialogs.length === 1) return dialogs[0].innerText;
    if (dialogs.length > 1) return null;

    // Only accept a bounded panel, never a slice of the whole page. More than
    // one matching panel is ambiguous even if their text happens to agree.
    const panels = new Set();
    const anchors = document.querySelectorAll(headingSelector + ',button,a');
    const unrelatedContent = /rental facts|what.s special|nearby homes|similar homes|available units/i;
    const maxAncestorDepth = 6;
    const maxPanelCharacters = 12000;

    for (const anchor of anchors) {
      if (anchor.textContent.trim() !== 'Cost calculator' || !isVisible(anchor)) continue;

      let panel = anchor.parentElement;
      for (let depth = 0; panel && depth < maxAncestorDepth; depth++, panel = panel.parentElement) {
        if (panel === document.body) break;
        const text = panel.innerText || '';
        if (text.length > maxPanelCharacters || unrelatedContent.test(text)) break;

        const hasCostSections = /monthly costs/i.test(text) && /move-in costs/i.test(text);
        if (!hasCostSections) continue;
        if (!panel.querySelector(propertyLinkSelector)) panels.add(panel);
        break;
      }
    }

    if (panels.size !== 1) return null;
    return [...panels][0].innerText;
  }

  function readListingSections() {
    const acceptedLabels = new Set([
      "What's special",
      'Facts, features & policies',
      'Policies',
      'Building Amenities',
      'Unit Features',
      'Available units',
    ]);
    const sections = {};
    const unrelatedContent = /nearby homes|similar homes|nearby apartments|nearby cities/i;
    const maxAncestorDepth = 3;
    const maxSectionCharacters = 16000;

    for (const heading of document.querySelectorAll(headingSelector)) {
      const label = heading.textContent.trim();
      if (!acceptedLabels.has(label) || !isVisible(heading)) continue;

      let section = heading.parentElement;
      for (let depth = 0; section && depth < maxAncestorDepth; depth++, section = section.parentElement) {
        if (section === document.body) break;
        const text = section.innerText?.trim();
        if (!text || text === label) continue;
        if (text.length > maxSectionCharacters || unrelatedContent.test(text)) break;

        // Same-level headings mark peer sections. Lower-level headings inside
        // facts or policies are part of that section, not contamination.
        const peerSelector = heading.hasAttribute('role') ? '[role="heading"]' : heading.tagName;
        const peers = [...section.querySelectorAll(peerSelector)];
        const spansOtherSections = peers.some(peer => peer !== heading && peer.textContent.trim() !== label);
        if (spansOtherSections) break;

        (sections[label] ??= []).push(text);
        break;
      }
    }

    for (const label of Object.keys(sections)) {
      sections[label] = [...new Set(sections[label])];
    }
    return sections;
  }

  function clickCalculator() {
    const controls = [...document.querySelectorAll('button,a')].filter(control => {
      return isVisible(control) && control.textContent.trim() === 'Cost calculator';
    });
    if (controls.length !== 1) {
      return {
        clicked: false,
        reason: controls.length ? 'ambiguous' : 'not_available',
        url: location.href,
        title: document.title,
        text: document.body.innerText,
      };
    }
    controls[0].click();
    return {
      clicked: true,
      reason: null,
      url: location.href,
      title: document.title,
      text: document.body.innerText,
    };
  }

  if (action === 'open_calculator') return JSON.stringify(clickCalculator());
  if (action === 'open_unit_menu' || action === 'select_unit') {
    try {
      return JSON.stringify(unitSelection(action));
    } catch (error) {
      // Include page evidence so verification still takes the human-handoff path.
      return JSON.stringify({
        error: error.message,
        url: location.href,
        title: document.title,
        text: document.body.innerText,
      });
    }
  }
  if (action !== 'snapshot') throw new Error('Unknown listing page action');

  const pageProps = readPageProps();
  return JSON.stringify({
    url: location.href,
    canonicalUrl: document.querySelector('link[rel="canonical"]')?.href ?? null,
    title: document.title,
    text: document.body.innerText,
    properties: readHydratedProperties(pageProps),
    building: readHydratedBuilding(pageProps),
    photos: readRenderedPhotos(),
    ogImage: document.querySelector('meta[property="og:image"]')?.content ?? null,
    calculatorText: readCalculatorText(),
    calculatorUnit: readCalculatorUnit(),
    sections: readListingSections(),
  });
}
