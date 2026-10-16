/* ==========================================================================
   lint.test.mjs  -  the deep pass, against pages built to break it
   --------------------------------------------------------------------------
   The linter exists to catch the wrong-page-that-fits: text on text, grey on
   white, an SVG label with no fill. A tool that only ever says "all clear" is
   worthless, so this suite hands it a page with every rule violated on purpose
   and checks each one comes back.

   The page is written to the OS temp folder, never into books/.
   ========================================================================== */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ok, group, report, cli } from './harness.mjs';
import { launch, open } from '../../tools/lib/render.mjs';
import { lintBook } from '../../tools/lib/lint.mjs';

const HTML = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#fff}
  .sheet{width:176mm;height:250mm;box-sizing:border-box;padding:14mm;position:relative;
         background:#fff;overflow:hidden;font-family:serif}
  .blk{position:absolute;font-size:16px}
</style></head><body>${body}</body></html>`;

const VIOLATIONS = HTML(`
<section class="sheet">
  <p class="blk" style="top:10mm;left:20mm">overlap alpha</p>
  <p class="blk" style="top:10mm;left:24mm">overlap beta</p>
  <p style="color:#dddddd;font-size:15px">grey text on white, a contrast miss</p>
  <p style="font-family:'Space Grotesk',serif;font-size:15px">a family that was never loaded</p>
  <p style="margin-right:-20mm">this paragraph crosses the print margin</p>
  <p style="width:200px;font-size:15px">This sentence fills a couple of lines and then ends on a single word:<br>yes</p>
  <svg style="display:block;margin-top:110mm" width="220" height="40" viewBox="0 0 220 40"><text x="4" y="22" font-size="8">tiny with no fill</text></svg>
</section>`);

const CLEAN = HTML(`
<section class="sheet">
  <p style="color:#111111;font-size:16px">A normal paragraph of dark body text on white, long enough to run onto a second line and read as a real block of prose.</p>
  <p style="color:#111111;font-size:16px">A second paragraph, again dark on white, so there is no large empty band between the blocks and the page does not look starved.</p>
  <svg width="220" height="40" viewBox="0 0 220 40"><text x="4" y="22" font-size="12" fill="#111111">A label with a fill</text></svg>
</section>`);

const tmp = (name, html) => {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, html, 'utf8');
  return p;
};

const browser = await launch();
const rulesIn = async (file) => {
  const page = await open(browser, file);
  const lint = await lintBook(page);
  await page.close();
  const all = lint.pages.flatMap((p) => p.findings);
  return { all, errors: all.filter((f) => f.level === 'error'), rules: new Set(all.map((f) => f.rule)) };
};

try {
  group('a page with every rule broken on purpose');
  const bad = await rulesIn(tmp('paper-lint-bad.html', VIOLATIONS));
  for (const rule of ['overlap', 'contrast', 'safe-zone', 'font', 'no-fill', 'ink-floor', 'runt', 'gap']) {
    ok(`finds ${rule}`, bad.rules.has(rule), [...bad.rules].join(','));
  }

  group('a page that is actually correct');
  const good = await rulesIn(tmp('paper-lint-good.html', CLEAN));
  ok('no errors on a clean page', good.errors.length === 0,
    good.errors.map((e) => `${e.rule}: ${e.msg}`).join(' | '));
  ok('no contrast / overlap / no-fill / safe-zone / font false positives',
    !['contrast', 'overlap', 'no-fill', 'safe-zone', 'font'].some((r) => good.rules.has(r)),
    [...good.rules].join(','));
} finally {
  await browser.close();
  fs.rmSync(path.join(os.tmpdir(), 'paper-lint-bad.html'), { force: true });
  fs.rmSync(path.join(os.tmpdir(), 'paper-lint-good.html'), { force: true });
}

group('the CLI surface');
{
  const plain = cli('check.mjs', 'books/starter/book.html', '--json');
  ok('default check exits 0', plain.code === 0);
  const pj = JSON.parse(plain.stdout);
  ok('default check has no lint (opt-in)', pj.lint === null);
  ok('default check still reports ready:true', pj.ready === true);

  const lit = cli('check.mjs', 'books/starter/book.html', '--json', '--lint');
  ok('linted check exits 0 on a clean book', lit.code === 0);
  const lj = JSON.parse(lit.stdout);
  ok('linted check carries a lint object', lj.lint && Array.isArray(lj.lint.pages) && lj.lint.pages.length > 0);
  const errs = lj.lint.pages.flatMap((p) => p.findings).filter((f) => f.level === 'error');
  ok('linted check finds no errors on starter', errs.length === 0, errs.map((e) => e.msg).join(' | '));
  ok('linted check still ready:true', lj.ready === true);
}

report('lint');
