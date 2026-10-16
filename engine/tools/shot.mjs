/* ==========================================================================
   shot.mjs  -  screenshot every page, so you can look at them
   --------------------------------------------------------------------------
   check.mjs proves a page FITS. Only your eyes prove it is any good. This
   writes one PNG per page so you can read them all in a row, on screen or in
   an agent that can see images.

   Usage:  node engine/tools/shot.mjs <book.html> [out-dir]

   Default out-dir is the book's own folder (page1.png, page2.png, ...), which
   .gitignore already keeps out of git. Pass an out-dir to keep a set around
   for comparison.
   ========================================================================== */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node engine/tools/shot.mjs <book.html> [out-dir]');
  process.exit(1);
}
const abs = path.resolve(input);
const outdir = path.resolve(process.argv[3] || path.dirname(abs));
fs.mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 });   // retina: readable 11px labels
  await page.goto(pathToFileURL(abs).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  // Size the viewport to the actual page so element screenshots never clip.
  const box = await page.evaluate(() => {
    const s = document.querySelector('.sheet');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { width: Math.ceil(r.width) + 40, height: Math.ceil(r.height) + 40 };
  });
  if (!box) {
    console.error('No .sheet found in ' + input);
    process.exit(1);
  }
  await page.setViewportSize(box);

  const sheets = await page.$$('.sheet');
  for (let i = 0; i < sheets.length; i++) {
    await sheets[i].screenshot({ path: path.join(outdir, `page${i + 1}.png`) });
  }
  console.log(`wrote ${sheets.length} screenshots to ${outdir}`);
  console.log('Now READ them. The check cannot see overlap, clipping, or a diagram that says the wrong thing.');
} finally {
  await browser.close();
}
