export const site = 'gusto.com';

export default async function({ page }) {
  await page.goto('https://gusto.com', { waitUntil: 'domcontentloaded' });

  // Wait for Cloudflare challenge to resolve (title changes from "Just a moment...")
  await page.waitForFunction(() => document.title !== 'Just a moment...', { timeout: 60000 });
  await page.waitForTimeout(2000);

  const data = await page.evaluate(() => {
    const title = document.title;

    // Extract navigation links
    const navLinks = [...document.querySelectorAll('nav a')].map(a => ({
      text: a.textContent?.trim(),
      href: a.href,
    })).filter(l => l.text);

    // Extract main headings
    const headings = [...document.querySelectorAll('h1, h2')].map(h => ({
      level: h.tagName.toLowerCase(),
      text: h.textContent?.trim(),
    })).filter(h => h.text);

    // Extract CTA buttons/links
    const ctas = [...document.querySelectorAll('a[href*="sign"], a[href*="demo"], a[href*="pricing"], button')].map(el => ({
      text: el.textContent?.trim(),
      href: el.href || null,
    })).filter(c => c.text);

    return { title, navLinks, headings, ctas };
  });

  console.log(JSON.stringify(data));
}
