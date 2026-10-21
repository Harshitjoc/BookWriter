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
import fs from 'node:fs';

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
 *
 * `frozen` puts an animated book at its still pose before anything looks at it.
 * It emulates prefers-reduced-motion (which motion.css already honours) and then
 * calls the runtime's own window.__proofpressFreeze() if the page has one. A
 * book with no motion is unaffected: the emulation changes nothing on a page
 * whose CSS has no animations, and there is no freeze hook to call. This is what
 * lets check.mjs read the same 0 mm on a moving page that paper will get.
 */
export async function open(browser, file, { deviceScaleFactor, frozen = false } = {}) {
  const page = await browser.newPage(deviceScaleFactor ? { deviceScaleFactor } : undefined);
  if (frozen) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(path.resolve(file)).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (frozen) {
    await page.evaluate(() => {
      if (typeof window.__proofpressFreeze === 'function') window.__proofpressFreeze();
    });
  }
  return page;
}

/** Whether a built book carries motion, read straight off the file. Cheap, so a
 *  caller can decide to freeze without opening the page first. */
export function hasMotion(file) {
  try {
    return /data-motion=/.test(fs.readFileSync(file, 'utf8'));
  } catch { return false; }
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
