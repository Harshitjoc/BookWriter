/* ==========================================================================
   export-epub.mjs  -  a built book, as an EPUB3
   --------------------------------------------------------------------------
   The PDF is the page you designed. The EPUB is the same book, reflowable, for
   a phone or a reader. One page becomes one chapter; the fixed B5 box is set
   aside (an ebook has no fixed page), so the reader styles a small, sane
   reading sheet over the book's own class names.

   No dependency: the archive is written by lib/zip.mjs, store-only, with
   "mimetype" first and uncompressed — which is exactly what EPUB requires.

   Usage:
       node engine/tools/export-epub.mjs books/<slug>/book.html
       node engine/tools/export-epub.mjs books/<slug>/book.html --out out.epub
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { zipStore } from './lib/zip.mjs';
import { splitSheets, collectImages, xhtmlSafe } from './lib/book-html.mjs';

const argv = process.argv.slice(2);
const input = argv.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('Usage: node engine/tools/export-epub.mjs <book.html> [--out <file.epub>] [--json]');
  process.exit(1);
}
const flag = (name) => { const i = argv.indexOf('--' + name); return i === -1 ? null : argv[i + 1]; };
const asJson = argv.includes('--json');

const bookDir = path.dirname(path.resolve(input));
const outPath = path.resolve(flag('out') || path.join(bookDir, 'book.epub'));
const html = fs.readFileSync(path.resolve(input), 'utf8');

const titleTag = html.match(/<title>([\s\S]*?)<\/title>/);
const bookTitle = titleTag ? titleTag[1].trim() : path.basename(bookDir);

const sheets = splitSheets(html);
if (!sheets.length) { console.error('no sheets found in ' + input); process.exit(1); }

/* Cover + copyright + the book pages. The generated contents/divider/index are
   furniture for print; an ebook has its own navigation, so they are left out. */
const chapters = sheets.filter((s) => s.isBook || /\bcover\b|\bcolophon\b/.test(s.cls));
if (!chapters.length) { console.error('no book pages found in ' + input); process.exit(1); }

/* ---- reading stylesheet: gentle, reflowable, no fixed page ---------------- */
const EPUB_CSS = `html{font-size:100%}
body{margin:0;padding:0 5%;font-family:Georgia,"Times New Roman",serif;line-height:1.6;color:#1a1a2e}
section{max-width:34em;margin:0 auto;padding:2em 0}
.eyebrow{font-family:system-ui,sans-serif;font-size:.72em;letter-spacing:.16em;text-transform:uppercase;color:#6b7280;margin:0 0 .8em}
.eyebrow b{color:#4f46e5}
h1.title{font-family:system-ui,sans-serif;font-size:1.7em;line-height:1.2;margin:0 0 .3em}
.sub{font-size:1.05em;color:#4b5563;margin:0 0 1.4em}
.diagram{margin:1.5em 0;text-align:center}
.diagram svg{max-width:100%;height:auto}
.explain p{margin:0 0 .9em}
.explain strong{color:#111827}
.action{margin:1.6em 0 0;padding:.9em 1.1em;border-left:3px solid #14b8a6;background:#f4fbfa}
.action b{font-family:system-ui,sans-serif;display:block;margin-bottom:.3em}
.foot{margin-top:2em;padding-top:.8em;border-top:1px solid #e5e7eb;font-size:.78em;color:#6b7280;font-family:system-ui,sans-serif;display:flex;justify-content:space-between}
.cv-title{font-family:system-ui,sans-serif;font-size:2.4em;line-height:1.05;margin:1.5em 0 .3em}
.cv-sub{font-size:1.2em;color:#4b5563}
.cv-meta{margin-top:1.5em;font-size:.9em;color:#6b7280}
img{max-width:100%;height:auto}
.gp-tab{display:none}
.eyebrow,.foot{display:flex}`;

/* ---- chapters ------------------------------------------------------------ */
const files = [];
const manifest = [];
const spine = [];
const navItems = [];
let i = 0;

for (const sheet of chapters) {
  i += 1;
  const id = `ch${i}`;
  const file = `chapter-${i}.xhtml`;
  const body = xhtmlSafe(sheet.html);
  const doc = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head><meta charset="utf-8"/><title>${escapeXml(sheet.title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>
`;
  files.push({ name: `OEBPS/${file}`, data: doc });
  manifest.push(`    <item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
  spine.push(`    <itemref idref="${id}"/>`);
  navItems.push(`      <li><a href="${file}">${escapeXml(sheet.title)}</a></li>`);
}

/* ---- images -------------------------------------------------------------- */
for (const src of collectImages(chapters)) {
  const abs = path.resolve(bookDir, src.replace(/^\.\//, ''));
  if (!fs.existsSync(abs)) continue;
  const dest = src.replace(/^\.\//, '');
  const ext = path.extname(dest).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml'
    : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  files.push({ name: `OEBPS/${dest}`, data: fs.readFileSync(abs) });
  manifest.push(`    <item id="img-${manifest.length}" href="${dest}" media-type="${mime}"/>`);
}

/* ---- nav ----------------------------------------------------------------- */
const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${navItems.join('\n')}
    </ol>
  </nav>
</body>
</html>
`;
files.push({ name: 'OEBPS/nav.xhtml', data: nav });
files.push({ name: 'OEBPS/style.css', data: EPUB_CSS });

const uuid = crypto.createHash('sha1').update(bookTitle).digest('hex').replace(
  /(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(bookTitle)}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2000-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifest.join('\n')}
  </manifest>
  <spine toc="nav">
${spine.join('\n')}
  </spine>
</package>
`;
files.push({ name: 'OEBPS/content.opf', data: opf });
files.push({ name: 'META-INF/container.xml', data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
` });
files.unshift({ name: 'mimetype', data: 'application/epub+zip' });

const buf = zipStore(files);
fs.writeFileSync(outPath, buf);

if (asJson) {
  console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath).replace(/\\/g, '/'), chapters: chapters.length, files: files.length, bytes: buf.length }));
} else {
  console.log(`wrote ${path.relative(process.cwd(), outPath).replace(/\\/g, '/')}  (${chapters.length} chapters, ${(buf.length / 1024).toFixed(1)} kB)`);
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
