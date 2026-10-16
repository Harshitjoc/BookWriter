/* ==========================================================================
   export.mjs  -  deterministic HTML -> PDF via headless Chrome (Playwright)
   --------------------------------------------------------------------------
   The same PDF every time, with no print-dialog settings to forget. It obeys
   `@page { size:B5; margin:0 }` from the size file and prints backgrounds, so
   the PDF is a 1:1 capture of the page you were looking at.

   You can also do this by hand in a browser (Ctrl/Cmd+P -> Save as PDF, with
   Margins: None, Scale: 100, Background graphics: ON). This command is the
   version that cannot be got wrong.

   Setup (one time):
       npm install
       npx playwright install chromium

   Use:
       node engine/tools/export.mjs books/showcase/book.html          -> book.pdf
       node engine/tools/export.mjs books/showcase/book.html out.pdf  -> out.pdf
       node engine/tools/export.mjs a.html b.html                     -> a.pdf, b.pdf
   ========================================================================== */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('Usage: node engine/tools/export.mjs <book.html> [out.pdf | more .html files...] [--tagged] [--outline]');
  process.exit(1);
}

/* Flags are pulled out first so the positional arguments keep their meaning:
   `--tagged` writes an accessible (tagged) PDF, `--outline` builds the PDF
   bookmarks from the document headings. Both are off unless asked for, so the
   default PDF is unchanged. */
const FLAGS = new Set(['--tagged', '--outline']);
const tagged = argv.includes('--tagged');
const outline = argv.includes('--outline');
const files = argv.filter((a) => !FLAGS.has(a));

// Two-arg form "in.html out.pdf" -> single job; otherwise every arg is an input.
let jobs;
if (files.length === 2 && /\.pdf$/i.test(files[1])) {
  jobs = [{ in: files[0], out: files[1] }];
} else {
  jobs = files.map((f) => ({ in: f, out: f.replace(/\.html?$/i, '.pdf') }));
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const job of jobs) {
    const abs = path.resolve(job.in);
    await page.goto(pathToFileURL(abs).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);   // web fonts change text height
    const opts = {
      path: path.resolve(job.out),
      preferCSSPageSize: true,   // obey @page { size:B5; margin:0 }
      printBackground: true,     // keep the colours
    };
    if (tagged) opts.tagged = true;     // accessible PDF with a structure tree
    if (outline) opts.outline = true;   // PDF bookmarks from the headings
    await page.pdf(opts);
    console.log('  wrote ' + job.out);
  }
} finally {
  await browser.close();
}
