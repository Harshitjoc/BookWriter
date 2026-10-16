/* ==========================================================================
   test/print.test.mjs  -  bleed, gutter, recto starts, and the tagged PDF
   --------------------------------------------------------------------------
   Phase 6 is print craft, and print craft is opt-in: a plain build must not
   move a byte (engine/tools/regress.mjs holds that line globally). These tests
   prove the flags actually do something when asked, and that the default output
   is untouched, and that --tagged / --outline reach the PDF.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ok, group, report, cli, scratchBook } from './harness.mjs';
import { splitSheets } from '../../tools/lib/book-html.mjs';

const b = scratchBook('uitest');
const tmp = (name) => path.join(os.tmpdir(), `print-${process.pid}-${name}`);

const built = cli('build-book.mjs', 'books/uitest');
ok('the scratch book builds', built.code === 0, built.stderr.slice(0, 120));
const plain = fs.readFileSync(path.join(b.dir, 'book.html'), 'utf8');
const plainSheets = splitSheets(plain).length;

/* ------------------------------------------------------ opt-in by default */
group('a plain build carries no craft rules');
{
  ok('no gutter rule', !/nth-child\(odd\)\{ padding-left:calc\(var\(--page-pad\)/.test(plain));
  ok('no bleed page size', !/size:calc\(var\(--page-w\)/.test(plain));
  ok('no blank pages', splitSheets(plain).every((s) => !/\bblank\b/.test(s.cls)));
}

/* -------------------------------------------------------- gutter and bleed */
group('gutter and bleed are written only when asked');
{
  const out = tmp('craft.html');
  const r = cli('build-book.mjs', 'books/uitest', '--gutter', '8', '--bleed', '3', '--out', out);
  ok('build with --gutter/--bleed exits 0', r.code === 0, r.stderr.slice(0, 160));
  const html = fs.readFileSync(out, 'utf8');
  ok('a gutter rule is emitted', /nth-child\(odd\)\{ padding-left:calc\(var\(--page-pad\) \+ 8mm\)/.test(html));
  ok('the gutter is mirrored', /nth-child\(even\)\{ padding-right:calc\(var\(--page-pad\) \+ 8mm\)/.test(html));
  ok('the print page grows by 2x bleed', /@page\{ size:calc\(var\(--page-w\) \+ 6mm\) calc\(var\(--page-h\) \+ 6mm\)/.test(html));
  ok('the paper colour bleeds', /box-shadow:0 0 0 3mm var\(--paper\)/.test(html));
  ok('the craft build still has the same pages', splitSheets(html).length === plainSheets);
  ok('the run reports the craft', /\[gutter 8mm, bleed 3mm\]/.test(r.stdout), r.stdout.trim().split('\n').pop());
}

/* ------------------------------------------------------------ recto starts */
group('--start-recto opens each part on a right-hand page');
{
  const out = tmp('recto.html');
  const r = cli('build-book.mjs', 'books/uitest', '--start-recto', '--out', out);
  ok('build with --start-recto exits 0', r.code === 0, r.stderr.slice(0, 160));
  const sheets = splitSheets(fs.readFileSync(out, 'utf8'));
  const dividerPages = sheets.map((s, i) => ({ s, n: i + 1 })).filter((x) => /\bdivider\b/.test(x.s.cls)).map((x) => x.n);
  const blanks = sheets.filter((s) => /\bblank\b/.test(s.cls)).length;
  ok('a blank verso was inserted', blanks >= 1, String(blanks));
  ok('that blank altered the page count', sheets.length > plainSheets, `${sheets.length} vs ${plainSheets}`);
  ok('every part divider is on an odd page', dividerPages.length > 0 && dividerPages.every((n) => n % 2 === 1),
    dividerPages.join(', '));
  ok('the run reports the recto starts', /\[recto starts\]/.test(r.stdout));
}

/* ------------------------------------------------------- tagged / outline */
group('--tagged and --outline reach the PDF');
{
  const tagged = tmp('tagged.pdf');
  const plainPdf = tmp('plain.pdf');
  const rt = cli('export.mjs', 'books/uitest/book.html', tagged, '--tagged', '--outline');
  ok('export with tags exits 0', rt.code === 0, rt.stderr.slice(0, 160));
  const rp = cli('export.mjs', 'books/uitest/book.html', plainPdf);
  ok('a plain export exits 0', rp.code === 0, rp.stderr.slice(0, 160));

  const t = fs.readFileSync(tagged).toString('latin1');
  const p = fs.readFileSync(plainPdf).toString('latin1');
  ok('the tagged PDF has a structure tree', t.includes('/StructTreeRoot'));
  ok('the tagged PDF has bookmarks', t.includes('/Outlines'));
  ok('the plain PDF has no structure tree', !p.includes('/StructTreeRoot'));
  ok('the plain PDF has no bookmarks', !p.includes('/Outlines'));

  for (const f of [tagged, plainPdf]) fs.rmSync(f, { force: true });
}

b.drop();
report('print');
