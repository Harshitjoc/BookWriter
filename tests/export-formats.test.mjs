/* ==========================================================================
   test/export-formats.test.mjs  -  the three exports, and the zip under the EPUB
   --------------------------------------------------------------------------
   export-epub.mjs, export-web.mjs and export-card.mjs are run exactly as a
   person runs them — via the CLI — against a scratch copy of books/starter, and
   their output is opened back up and checked. The zip is read with the same
   store-only reader that this project would ship, so the EPUB is verified as a
   zip, not merely as a file that starts with PK.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { ok, group, report, cli, scratchBook } from './harness.mjs';
import { zipStore, unzipStore } from '../src/engine/tools/lib/zip.mjs';
import { splitSheets } from '../src/engine/tools/lib/book-html.mjs';

const b = scratchBook('uitest');

/* One pixel of PNG, so the exporters have something real to inline. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64');

/* Drop an image into the book and reference it, so image inlining is exercised. */
const imgDir = path.join(b.dir, 'images');
fs.mkdirSync(imgDir, { recursive: true });
fs.writeFileSync(path.join(imgDir, 'test.png'), PNG);
let interior = fs.readFileSync(b.interior, 'utf8');
interior = interior.replace(
  /(<div class="explain">)/,
  '<figure class="photo"><img src="images/test.png" alt="a single pixel"></figure>\n      $1');
fs.writeFileSync(b.interior, interior);

const built = cli('build-book.mjs', 'books/uitest');
ok('the scratch book builds', built.code === 0, built.stderr.slice(0, 120));

const bookHtml = path.join(b.dir, 'book.html');
const bookSrc = fs.readFileSync(bookHtml, 'utf8');
const sheets = splitSheets(bookSrc);
const bbCount = sheets.filter((s) => s.isBook).length;
const coverCount = sheets.filter((s) => /\bcover\b/.test(s.cls)).length;
const colophonCount = sheets.filter((s) => /\bcolophon\b/.test(s.cls)).length;
const bbIndex = sheets.findIndex((s) => s.isBook);

/* -------------------------------------------------------- the zip writer */
group('the store-only zip writer round-trips');
{
  const files = [
    { name: 'b.txt', data: 'second' },
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'a/deep.txt', data: Buffer.from([0, 1, 2, 3, 255]) },
  ];
  const zip = zipStore(files);
  const back = unzipStore(zip);
  ok('every entry comes back', back.size === 3, `${back.size} entries`);
  ok('a text entry survives', back.get('b.txt').toString('utf8') === 'second');
  ok('binary bytes survive', Buffer.compare(back.get('a/deep.txt'), Buffer.from([0, 1, 2, 3, 255])) === 0);
  ok('a nested name survives', back.has('a/deep.txt'));
  ok('the archive starts with the local-header signature', zip.readUInt32LE(0) === 0x04034b50);

  const nameLen = zip.readUInt16LE(26);
  const firstName = zip.toString('utf8', 30, 30 + nameLen);
  ok('mimetype is the first entry', firstName === 'mimetype', firstName);
  ok('mimetype is stored, not compressed', zip.readUInt16LE(8) === 0);

  const again = zipStore(files);
  ok('the same files zip to the same bytes', Buffer.compare(zip, again) === 0);
}

/* --------------------------------------------------------------- EPUB */
group('a book becomes an EPUB');
{
  const out = path.join(b.dir, 'out.epub');
  const r = cli('export-epub.mjs', 'books/uitest/book.html', '--out', out, '--json');
  ok('export-epub exits 0', r.code === 0, r.stderr.slice(0, 160));
  ok('an epub file is written', fs.existsSync(out));

  let meta = {};
  try { meta = JSON.parse(r.stdout.trim()); } catch { /* reported below */ }
  ok('the report is json', typeof meta.chapters === 'number', r.stdout.slice(0, 80));

  const buf = fs.readFileSync(out);
  const entries = unzipStore(buf);
  ok('it opens as a zip', entries.size > 0, `${entries.size} entries`);
  ok('it carries the epub mimetype', entries.get('mimetype')?.toString('utf8') === 'application/epub+zip');
  ok('the container points at the package', entries.get('META-INF/container.xml')?.toString('utf8').includes('OEBPS/content.opf'));
  ok('there is a content.opf', entries.has('OEBPS/content.opf'));
  ok('there is a navigation document', entries.has('OEBPS/nav.xhtml'));
  ok('there is a stylesheet', entries.has('OEBPS/style.css'));
  ok('the referenced image is packaged', entries.has('OEBPS/images/test.png'));

  const chapters = [...entries.keys()].filter((k) => /^OEBPS\/chapter-\d+\.xhtml$/.test(k));
  const expected = coverCount + colophonCount + bbCount;
  ok('one chapter per cover + copyright + book page', chapters.length === expected, `${chapters.length} vs ${expected}`);

  const opf = entries.get('OEBPS/content.opf').toString('utf8');
  ok('the package declares the nav as the toc', /properties="nav"/.test(opf) && /<spine toc="nav">/.test(opf));
  ok('the package names the book', /<dc:title>[^<]+<\/dc:title>/.test(opf));
  ok('every chapter is in the spine', (opf.match(/<itemref /g) || []).length === chapters.length);

  const nav = entries.get('OEBPS/nav.xhtml').toString('utf8');
  ok('the nav lists a link per chapter', (nav.match(/<a href="chapter-/g) || []).length === chapters.length);

  const first = entries.get(chapters[0]).toString('utf8');
  ok('a chapter is a full xhtml document', first.startsWith('<?xml') && /<\/html>\s*$/.test(first));
  ok('the chapter self-closes void tags', !/<br\s*>/.test(first) && !/<img[^>]*[^/]>\s*(?!<\w)/.test(first.replace(/\/>/g, '>')));
}

/* ---------------------------------------------------------------- web */
group('a book becomes one portable web file');
{
  const out = path.join(b.dir, 'out-web.html');
  const r = cli('export-web.mjs', 'books/uitest/book.html', '--out', out, '--json');
  ok('export-web exits 0', r.code === 0, r.stderr.slice(0, 160));

  let meta = {};
  try { meta = JSON.parse(r.stdout.trim()); } catch { /* reported below */ }
  ok('it reports every sheet', meta.pages === sheets.length, `${meta.pages} vs ${sheets.length}`);
  ok('it inlined the stylesheets', meta.inlinedCss >= 3, String(meta.inlinedCss));
  ok('it inlined the image', meta.inlinedImg >= 1, String(meta.inlinedImg));

  const doc = fs.readFileSync(out, 'utf8');
  /* The engine CSS shows example <head> markup in its own comment, so a naive
     search for "<link" would trip on documentation. Strip comments first. */
  const clean = doc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  ok('it is one document', /^<!doctype html>/i.test(doc.trimStart()) && doc.trimEnd().endsWith('</html>'));
  ok('no stylesheet is still linked', !/<link[^>]*stylesheet/i.test(clean));
  ok('no images are left as files', !/<img[^>]*src="images\//.test(clean));
  ok('the image is a data uri', doc.includes('data:image/png;base64,'));
  ok('there is a reading bar', doc.includes('class="reader-bar"'));
  ok('every sheet got an anchor', doc.includes('id="pg-1"') && doc.includes(`id="pg-${sheets.length}"`));
  ok('it links arrows and a jump list', doc.includes('id="rb-jump"') && doc.includes('id="rb-next"'));
}

/* --------------------------------------------------------------- card */
group('one page becomes a card: html, png and markdown');
{
  const list = cli('export-card.mjs', 'books/uitest/book.html', '--list');
  ok('--list exits 0', list.code === 0, list.stderr.slice(0, 120));
  ok('--list names the book page', /SSRF/.test(list.stdout));

  const html = path.join(b.dir, 'card.html');
  const rh = cli('export-card.mjs', 'books/uitest/book.html', '--page', String(bbIndex + 1), '--format', 'html', '--out', html, '--json');
  ok('card html exits 0', rh.code === 0, rh.stderr.slice(0, 160));
  const hdoc = fs.readFileSync(html, 'utf8');
  ok('card html is a document', hdoc.includes('</html>') && hdoc.includes('<title>SSRF</title>'));
  ok('card html keeps the page title', hdoc.includes('<h1 class="title">SSRF</h1>'));
  ok('card html inlines assets', hdoc.includes('<style data-from=') && hdoc.includes('data:image/png;base64,'));

  const md = path.join(b.dir, 'card.md');
  const rm = cli('export-card.mjs', 'books/uitest/book.html', '--page', String(bbIndex + 1), '--format', 'md', '--out', md, '--json');
  ok('card md exits 0', rm.code === 0, rm.stderr.slice(0, 160));
  const mdoc = fs.readFileSync(md, 'utf8');
  ok('card md has a heading', /^# SSRF/m.test(mdoc));
  ok('card md has body prose', mdoc.length > 120, `${mdoc.length} chars`);

  const png = path.join(b.dir, 'card.png');
  const rp = cli('export-card.mjs', 'books/uitest/book.html', '--page', String(bbIndex + 1), '--format', 'png', '--out', png, '--json');
  ok('card png exits 0', rp.code === 0, rp.stderr.slice(0, 160));
  const pbuf = fs.existsSync(png) ? fs.readFileSync(png) : Buffer.alloc(0);
  ok('card png is a real png', pbuf[0] === 0x89 && pbuf[1] === 0x50 && pbuf[2] === 0x4E && pbuf[3] === 0x47);
  ok('card png is not empty', pbuf.length > 1000, `${pbuf.length} bytes`);

  const bad = cli('export-card.mjs', 'books/uitest/book.html', '--format', 'bogus');
  ok('an unknown format is refused', bad.code === 1 && /must be html, png or md/.test(bad.stderr));
}

b.drop();
report('export-formats');
