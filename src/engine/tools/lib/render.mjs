/* ==========================================================================
   lib/render.mjs  -  one way to open a built book in a real browser
   --------------------------------------------------------------------------
   check.mjs, lint.mjs, visual.mjs and shot.mjs all do the same three things
   before they can look at anything: launch Chromium, open the file, and wait
   for the self-hosted fonts. Doing that in four places meant four chances to
   forget document.fonts.ready, which changes the measured height of every
   paragraph. It lives here once.

   Nothing in here writes a book. It only opens and measures.
   ========================================================================== */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const PX_PER_MM = 96 / 25.4;
export const mm = (px) => px / PX_PER_MM;
export const round1 = (n) => Math.round(n * 10) / 10;

/** Launch Chromium. Caller closes it. */
export function launch() {
  return chromium.launch();
}

/**
 * Open an HTML file and wait until it is stable enough to measure: the network
 * is idle and the web fonts are done, because fonts change text height.
 */
export async function open(browser, file, { deviceScaleFactor } = {}) {
  const page = await browser.newPage(deviceScaleFactor ? { deviceScaleFactor } : undefined);
  await page.goto(pathToFileURL(path.resolve(file)).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/**
 * The measurements check.mjs has always taken. Kept byte-for-byte compatible
 * with its old inline version so its --json output does not move.
 */
export async function measureSheets(page) {
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.sheet')].map((el, i) => ({
      page: i + 1,
      title: (el.querySelector('.title')?.textContent || el.className.replace('sheet', '').trim() || '—').slice(0, 34),
      overMm: Math.max(0, Math.round((el.scrollHeight - el.clientHeight) / 96 * 25.4)),
    })));

  const broken = await page.evaluate(() =>
    [...document.images]
      .filter((i) => !i.complete || i.naturalWidth === 0)
      .map((i) => i.getAttribute('src')));

  const unstyled = await page.evaluate(() => {
    const s = document.querySelector('.sheet');
    return !s || Math.round(s.getBoundingClientRect().width) < 200;
  });

  const trim = await page.evaluate(() => {
    const s = document.querySelector('.sheet');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    const toMm = (px) => Math.round(px / 96 * 25.4 * 10) / 10;
    return {
      size: document.documentElement.dataset.size || null,
      widthMm: toMm(r.width),
      heightMm: toMm(r.height),
    };
  });

  return { rows, broken, unstyled, trim };
}
