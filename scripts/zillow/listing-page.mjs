// This function is serialized into the page through CDP. Keep its dependencies
// inside the function: imports and outer-scope bindings do not cross that boundary.
export function readListingPage(action = 'snapshot') {
  const headingSelector = 'h1,h2,h3,h4,[role="heading"]';
  const propertyLinkSelector = 'a[href*="/homedetails/"],a[href*="/b/"],a[href*="/apartments/"]';

  function isVisible(element) {
    return element.getClientRects().length > 0;
  }

  function readHydratedProperties() {
    const hydration = document.querySelector('#__NEXT_DATA__');
    if (!hydration) return [];

    const pageProps = JSON.parse(hydration.textContent)?.props?.pageProps;
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

  function readCalculatorText() {
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
  if (action !== 'snapshot') throw new Error('Unknown listing page action');

  return JSON.stringify({
    url: location.href,
    canonicalUrl: document.querySelector('link[rel="canonical"]')?.href ?? null,
    title: document.title,
    text: document.body.innerText,
    properties: readHydratedProperties(),
    photos: readRenderedPhotos(),
    ogImage: document.querySelector('meta[property="og:image"]')?.content ?? null,
    calculatorText: readCalculatorText(),
    sections: readListingSections(),
  });
}
