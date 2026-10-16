/* ==========================================================================
   export-card.mjs  -  lift one page out of the book, as HTML, PNG or Markdown
   --------------------------------------------------------------------------
   Sometimes one page is the whole point: a handout, a slide, a tweet-sized
   image, a section of a doc. This pulls the sheet you name out of a built book
   and writes it as a standalone file — so you never screenshot by hand or copy
   a page by hand.

   Usage:
       node engine/tools/export-card.mjs books/<slug>/book.html --page 3
       node engine/tools/export-card.mjs books/<slug>/book.html --page 3 --format png
       node engine/tools/export-card.mjs books/<slug>/book.html --page 3 --format md --out card.md
   --page counts every sheet in the built book (cover is 1). Read the titles with
   --list.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { splitSheets, inlineLocalAssets, headOf } from './lib/book-html.mjs';

const argv = process.argv.slice(2);
const input = argv.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('Usage: node engine/tools/export-card.mjs <book.html> [--page N] [--format html|png|md] [--out <file>]');
  process.exit(1);
}
const flag = (name) => { const i = argv.indexOf('--' + name); return i === -1 ? null : argv[i + 1]; };
const asJson = argv.includes('--json');

const abs = path.resolve(input);
const bookDir = path.dirname(abs);
const html = fs.readFileSync(abs, 'utf8');
const sheets = splitSheets(html);
if (!sheets.length) { console.error('no sheets found in ' + input); process.exit(1); }

if (argv.includes('--list')) {
  sheets.forEach((s, i) => console.log(`  ${String(i + 1).padStart(3)}  ${s.title}  [${s.cls.split(/\s+/).filter((c) => c !== 'sheet').join(' ')}]`));
  process.exit(0);
}

const pageNo = Math.max(1, Math.min(sheets.length, parseInt(flag('page') || '1', 10) || 1));
const sheet = sheets[pageNo - 1];
const format = (flag('format') || 'html').toLowerCase();
if (!['html', 'png', 'md'].includes(format)) { console.error('--format must be html, png or md'); process.exit(1); }

const ext = format === 'md' ? 'md' : format === 'png' ? 'png' : 'html';
const outPath = path.resolve(flag('out') || path.join(bookDir, `card-${pageNo}.${ext}`));

/* The one-page document: the original head (up to the first sheet), this sheet,
   then the closing tags — with stylesheets and images inlined so it stands
   alone. Asset inlining happens LAST, because the inlined CSS contains example
   <section class="sheet"> markup that would confuse any section match. */
const head = headOf(html);
const { html: onePage } = inlineLocalAssets(head + sheet.html, bookDir);
const doc = onePage.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(sheet.title)}</title>`)
  + '\n</main>\n</body>\n</html>\n';

if (format === 'html') {
  fs.writeFileSync(outPath, doc);
  report(outPath, format, pageNo, sheet.title, doc.length);
} else if (format === 'md') {
  const md = toMarkdown(sheet);
  fs.writeFileSync(outPath, md);
  report(outPath, format, pageNo, sheet.title, md.length);
} else {
  /* png: open the one-page html and screenshot the sheet itself. */
  const tmp = path.join(os.tmpdir(), `card-${process.pid}-${pageNo}.html`);
  fs.writeFileSync(tmp, doc);
  try {
    const { launch } = await import('./lib/render.mjs');
    const browser = await launch();
    try {
      const page = await browser.newPage({ deviceScaleFactor: 2 });
      await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const el = page.locator('.sheet').first();
      await el.screenshot({ path: outPath, scale: 'device' });
      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  report(outPath, format, pageNo, sheet.title, fs.statSync(outPath).size);
}

function report(out, fmt, n, title, bytes) {
  const rel = path.relative(process.cwd(), out).replace(/\\/g, '/');
  if (asJson) console.log(JSON.stringify({ out: rel, format: fmt, page: n, title, bytes }));
  else console.log(`wrote ${rel}  (page ${n}: ${title}, ${fmt}, ${(bytes / 1024).toFixed(1)} kB)`);
}

/* ---- a page as Markdown: the reading content, not the fixed layout -------- */
function toMarkdown(sheet) {
  const s = sheet.html;
  const grab = (re) => { const m = s.match(re); return m ? m[1] : ''; };
  const title = clean(grab(/<h1 class="title">([\s\S]*?)<\/h1>/));
  const sub = clean(grab(/<(?:div|p) class="sub">([\s\S]*?)<\/(?:div|p)>/));
  const eyebrow = clean(grab(/<div class="eyebrow">([\s\S]*?)<\/div>/));

  const labels = [];
  const svgTexts = s.match(/<text\b[^>]*>([\s\S]*?)<\/text>/g) || [];
  for (const t of svgTexts) { const v = clean(t.replace(/<[^>]*>/g, '')); if (v) labels.push(v); }

  const explainParas = [];
  const explainBlock = grab(/<div class="explain">([\s\S]*?)<\/div>\s*(?:<div class="ask"|<div class="action"|<figure|<\/div>|$)/);
  for (const p of (explainBlock.match(/<p\b[^>]*>([\s\S]*?)<\/p>/g) || [])) {
    const v = clean(p.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ');
    if (v) explainParas.push(v);
  }

  const askBlock = s.match(/<div class="(?:ask|action)">([\s\S]*?)<\/div>/);
  const askLabel = askBlock ? clean(grab(/<div class="(?:ask|action)">[\s\S]*?<span class="lbl">([\s\S]*?)<\/span>/)) : '';
  const askPara = askBlock ? clean(askBlock[1].replace(/<span class="lbl">[\s\S]*?<\/span>/, '').replace(/<[^>]*>/g, '')) : '';

  const out = [];
  if (eyebrow) out.push(`> ${eyebrow}`, '');
  if (title) out.push(`# ${title}`, '');
  if (sub) out.push(`_${sub}_`, '');
  if (labels.length) out.push(`<!-- diagram -->`, `**Diagram:** ${labels.join(' · ')}`, '');
  for (const p of explainParas) out.push(p, '');
  if (askPara) out.push('---', '', `> **${askLabel || 'Act'}**`, `> ${askPara}`, '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function clean(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&rsquo;/g, '\u2019').replace(/&lsquo;/g, '\u2018')
    .replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D')
    .replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013')
    .replace(/&hellip;/g, '\u2026').replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '\u00B7').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
