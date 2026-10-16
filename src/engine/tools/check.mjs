/* ==========================================================================
   check.mjs  -  the gate. Overflow + broken images, as a command.
   --------------------------------------------------------------------------
   Every page is a rigid box that clips. This opens the book in a real browser,
   waits for the fonts, and measures how far past the bottom edge each page's
   content runs. A page is not done until it reads 0 mm here.

   Usage:  node src/engine/tools/check.mjs <book.html> [--json] [--lint]

    --json prints the same result as a machine-readable object on stdout and
    skips the human-readable table. Nothing else changes, so the default
    behaviour of this command is untouched. src/client/ uses it to render a real
    table instead of scraping console.table text.

    --lint turns on the DEEP pass (src/engine/tools/lib/lint.mjs): overlap, a text
    colour that fails contrast against its own background, an SVG label with no
    explicit fill, labels under the 11px ink floor, a page that is far too
    empty, and a font that silently fell back. It is opt-in on purpose: the
    default output and exit code of this command stay exactly as they were, and
    a book that has not been tuned against the linter is not failed by it.

   Exit code is 1 if any page overflows or any image failed to load, so it
   works in a script or a CI job. With --lint it also exits 1 on a lint error.

   What even --lint CANNOT see: a photo cropped through its subject, or a
   diagram that says the wrong thing. Those still only show in the PNGs.
   ========================================================================== */
import path from 'node:path';
import { launch, open, measureSheets } from './lib/render.mjs';
import { lintBook } from './lib/lint.mjs';

const input = process.argv[2];
if (!input || input.startsWith('--')) {
  console.error('Usage: node src/engine/tools/check.mjs <book.html> [--json] [--lint]');
  process.exit(1);
}
const asJson = process.argv.includes('--json');
const wantLint = process.argv.includes('--lint');
const abs = path.resolve(input);

const browser = await launch();
let result;
try {
  const page = await open(browser, abs);
  const { rows, broken, unstyled, trim } = await measureSheets(page);

  const over = rows.filter((r) => r.overMm > 0);
  const baseReady = !(over.length || broken.length || unstyled);

  let lint = null;
  let lintErrors = 0;
  let lintWarnings = 0;
  if (wantLint) {
    lint = await lintBook(page);
    lintErrors = lint.pages.reduce((n, p) => n + p.findings.filter((f) => f.level === 'error').length, 0);
    lintWarnings = lint.pages.reduce((n, p) => n + p.findings.filter((f) => f.level === 'warn').length, 0);
  }
  const ready = baseReady && lintErrors === 0;

  result = {
    input,
    pages: rows.length,
    trim,
    rows,
    overflowing: over.map((r) => ({ page: r.page, title: r.title, overMm: r.overMm })),
    broken,
    unstyled,
    lint,
    ready,
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.table(rows);
    console.log('pages:', rows.length);
    if (trim) console.log(`trim: ${trim.size || 'unstyled'} ${trim.widthMm} x ${trim.heightMm} mm`);
    console.log('overflowing:', over.length ? over.map((r) => `${r.page} (+${r.overMm}mm)`).join(', ') : 'none ✓');
    console.log('broken images:', broken.length ? broken.join(', ') : 'none ✓');
    if (unstyled) console.log('STYLESHEET: not applied ✗  — check the ../../src/engine/ link depth');

    if (lint) {
      console.log(`\nlint: ${lintErrors} error(s), ${lintWarnings} warning(s)`);
      for (const p of lint.pages) {
        for (const f of p.findings) {
          console.log(`  [${f.level === 'error' ? 'x' : '!'}] page ${p.page} (${p.title}): ${f.msg}`);
        }
      }
    }

    if (!ready) console.log('\nNOT READY. Fix the above, then run me again.');
    else console.log('\nAll pages fit. Now run shot.mjs and LOOK at them.');
  }

  if (!ready) process.exitCode = 1;
} finally {
  await browser.close();
}
