/* ==========================================================================
   build-book.mjs  -  turn your pages into a book
   --------------------------------------------------------------------------
   You write pages. This wraps them in everything else a book needs: a cover, a
   copyright page, a contents with real page numbers, a divider in front of
   every part, an alphabetical index, and one page counter running through all
   of it.

   Usage:
       node engine/tools/build-book.mjs books/<slug>
       node engine/tools/build-book.mjs books/<slug> --edition free
       node engine/tools/build-book.mjs books/<slug> --out books/<slug>/other.html

   Reads:   books/<slug>/book.json     the running order and everything printed
            books/<slug>/<slug>.html   your pages (the interior)
   Writes:  books/<slug>/book.html     GENERATED. Never hand-edit it.

   The interior is a POOL of pages. book.json's parts decide which ones are in
   the book and in what order, matched by each page's title. So reordering a
   book, or cutting a free edition out of it, is a JSON edit and never HTML
   surgery.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLang, resolveDirection } from './lib/locale.mjs';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------------------------------------------------------- arguments */
const argv = process.argv.slice(2);
const bookDir = argv.find((a) => !a.startsWith('--'));
if (!bookDir) {
  console.error('Usage: node engine/tools/build-book.mjs books/<slug> [--edition <name>] [--out <file>]');
  process.exit(1);
}
const flag = (name) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? null : argv[i + 1];
};
const editionName = flag('edition');

/* ---- print craft. Every one of these is opt-in and additive: with none of
   them set, the generated book is byte-for-byte what it always was (which is
   what engine/tools/regress.mjs holds). ---- */
const numArg = (name) => {
  const v = flag(name);
  const n = v == null ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const gutterMm = numArg('gutter') || 0;                    // extra inner (spine) margin
const hasBleed = argv.includes('--bleed');
const bleedMm = hasBleed ? (numArg('bleed') ?? 3) : 0;     // --bleed alone means 3mm
const startRecto = argv.includes('--start-recto');         // parts open on a right-hand page

const dir = path.resolve(bookDir);
const slug = path.basename(dir);

const die = (msg) => { console.error('\n' + msg + '\n'); process.exit(1); };

/* What a book gets when it does not say otherwise. Read once, used for both the
   defaults and the list of valid names, so adding a size or a theme is a change
   to engine/defaults.json plus its stylesheet — not a code change here. */
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ENGINE, 'defaults.json'), 'utf8'));

if (!fs.existsSync(dir)) die(`No such book folder: ${bookDir}`);
const jsonPath = path.join(dir, 'book.json');
if (!fs.existsSync(jsonPath)) die(`No book.json in ${bookDir}. Copy one from books/starter/.`);

let book;
try {
  book = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  die(`book.json is not valid JSON:\n  ${e.message}`);
}

const interiorPath = path.join(dir, book.interior || `${slug}.html`);
if (!fs.existsSync(interiorPath))
  die(`No interior file at ${path.relative(process.cwd(), interiorPath)}.\n` +
      `That is the file holding your <section class="sheet bb"> pages.\n` +
      `Name it ${slug}.html, or set "interior" in book.json.`);

/* ---- language, direction and script fonts. ALL opt-in. A book that names none
   of them takes the untouched path below, so the committed books build to the
   same bytes they always did. ---- */
let lang = null, pageDir = null;
try {
  lang = normalizeLang(book.lang);
  pageDir = resolveDirection(book);
} catch (e) { die(e.message); }

const fontPacks = book.fonts == null ? [] : (Array.isArray(book.fonts) ? book.fonts : [book.fonts]);
const PACKS = DEFAULTS.fontPacks || {};
for (const id of fontPacks) {
  if (!PACKS[id]) {
    die(`unknown font pack "${id}".\nKnown: ${Object.keys(PACKS).filter((k) => !k.startsWith('$')).join(', ')}`);
  }
}

const outPath = path.resolve(flag('out') ||
  path.join(dir, editionName ? `book-${editionName}.html` : 'book.html'));

/* ------------------------------------------------------------------ helpers */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const pad2 = (n) => String(n).padStart(2, '0');

/* -------------------------------------------- 1. split the interior into pages
   head = doctype .. <main class="deck">, then one chunk per page, then the tail. */
const html = fs.readFileSync(interiorPath, 'utf8');

/* Comments are blanked (same length, so every offset stays valid) before we look for
   pages: the file's own header comment shows the page markup as an example, and that
   must not be mistaken for a page. */
const scan = html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
/* Any attributes may follow the class list, in any order: an archetype hook is
   written <section class="sheet bb" data-archetype="procedure">, and a page that
   the builder cannot find is a page that silently never ships. */
const OPEN = /<section\s+class="[^"]*\bbb\b[^"]*"[^>]*>/g;
const opens = [...scan.matchAll(OPEN)];
if (!opens.length)
  die(`No pages found in ${path.basename(interiorPath)}.\n` +
      `A page is: <section class="sheet bb"> ... </section>`);

const head = html.slice(0, opens[0].index);
const closeIdx = scan.lastIndexOf('</section>') + '</section>'.length;
const tail = html.slice(closeIdx);
const pageChunks = [];
for (let i = 0; i < opens.length; i++) {
  const start = opens[i].index;
  const end = i + 1 < opens.length ? opens[i + 1].index : closeIdx;
  pageChunks.push(html.slice(start, end).replace(/\s+$/, ''));
}

/* key every page by its title, so book.json can name them */
const pool = new Map();
for (const chunk of pageChunks) {
  const m = chunk.match(/<h1 class="title">([\s\S]*?)<\/h1>/);
  if (!m) die('A page has no <h1 class="title">. Every page needs one; it is how book.json finds it.');
  const key = stripTags(m[1]);
  if (pool.has(key)) die(`Two pages are both titled "${key}". Titles have to be unique.`);
  pool.set(key, chunk);
}

/* --------------------------------------------------- 2. resolve the running order */
if (!Array.isArray(book.parts) || !book.parts.length)
  die('book.json needs a "parts" array, even if it is one part holding every page.');

const edition = editionName ? (book.editions || {})[editionName] : null;
if (editionName && !edition)
  die(`book.json has no edition named "${editionName}".\n` +
      `Add one under "editions", listing the page titles it keeps.`);
const keep = edition ? new Set(edition) : null;

const missing = [];
const parts = [];
for (const p of book.parts) {
  const titles = (p.blocks || []).filter((t) => !keep || keep.has(t));
  for (const t of titles) if (!pool.has(t)) missing.push(t);
  if (titles.length) parts.push({ ...p, titles });
}
if (missing.length)
  die(`book.json lists pages that are not in ${path.basename(interiorPath)}:\n` +
      missing.map((t) => `  - ${t}`).join('\n') +
      `\n\nEither write them, or take them out of book.json.`);
if (!parts.length) die('Nothing to build: every part came out empty.');

if (keep) {
  const unknown = [...keep].filter((t) => !pool.has(t));
  if (unknown.length)
    die(`The "${editionName}" edition lists pages that do not exist:\n` +
        unknown.map((t) => `  - ${t}`).join('\n'));
}

const placed = new Set(parts.flatMap((p) => p.titles));
const orphans = [...pool.keys()].filter((t) => !placed.has(t));
if (orphans.length && !edition)
  console.log(`note: ${orphans.length} page(s) in the interior are not in any part, so they are not in the book: ` +
              orphans.join(', '));

const allTitles = parts.flatMap((p) => p.titles);

/* ------------------------------------------------------- 3. printed book data */
const B = {
  title: book.title || slug,
  subtitle: book.subtitle || '',
  author: book.author || '',
  series: book.series || book.title || slug,
  brand: book.brand || '',
  edition: book.editionLabel || 'Edition 1.0',
  numbered: book.numbered !== false,
  accent: book.accent || '#6366F1',
  accentStrong: book.accentStrong || '#4F46E5',
  wantContents: book.contents !== false,
  wantIndex: book.index !== false,
  unit: book.unit || 'blocks',            // what you call a page, in printed copy
  unitOne: book.unitSingular || (book.unit || 'blocks').replace(/s$/, ''),
};
const countWord = (n) => `${n} ${n === 1 ? B.unitOne : B.unit}`;
const coverCfg = book.cover || {};
const copyCfg = book.copyright || {};

/* ------------------------------------------------------ 4. page-number layout
   Count first, so the contents can print real numbers. Every sheet advances the
   counter; only the block pages print it. */
const TOC_MAX_ROWS = 25;              // rows that fit one contents sheet
const INDEX_MAX_PER_PAGE = 91;        // names that fit one index sheet (3 columns)

const partRows = (p) => p.titles.length + 1;   // a header row + one row per page
const tocBins = [];
if (B.wantContents) {
  let cur = [], rows = 0;
  for (const p of parts) {
    const r = partRows(p);
    if (cur.length && rows + r > TOC_MAX_ROWS) { tocBins.push(cur); cur = []; rows = 0; }
    cur.push(p); rows += r;
  }
  if (cur.length) tocBins.push(cur);
}
const contentsPages = tocBins.length;
const indexPages = B.wantIndex ? Math.max(1, Math.ceil(allTitles.length / INDEX_MAX_PER_PAGE)) : 0;

let totalPages;
const pageOf = {}, partPageOf = new Map();
/* A blank verso inserted to push a part divider onto a right-hand page. */
const blankBeforePart = new Set(), blankBeforeIndex = new Set();

if (!startRecto) {
  let pg = 2 + contentsPages;           // cover + copyright + contents
  parts.forEach((p, i) => {
    pg += 1; partPageOf.set(i, pg);                       // the part divider
    for (const t of p.titles) { pg += 1; pageOf[t] = pg; }
  });
  totalPages = pg + indexPages;
} else {
  /* Recto starts: every part divider lands on an odd (right-hand) page. A blank
     verso is inserted wherever the counting would otherwise land it on an even
     page. Front matter is cover (1), copyright (2), then the contents pages. */
  let pg = 3 + contentsPages;           // the number the first divider would take
  parts.forEach((p, i) => {
    if (pg % 2 === 0) { blankBeforePart.add(i); pg += 1; }
    partPageOf.set(i, pg); pg += 1;
    for (const t of p.titles) { pageOf[t] = pg; pg += 1; }
  });
  for (let k = 0; k < indexPages; k++) {
    if (pg % 2 === 0) { blankBeforeIndex.add(k); pg += 1; }
    pg += 1;
  }
  totalPages = pg - 1;
}

/* --------------------------------------------------------- 5. generated pages */
const genFoot = (right) =>
  `<div class="gp-foot"><span>${esc(B.brand || B.series)}</span><span>${esc(right)}</span></div>`;

const coverSection = `    <section class="sheet gp cover">
      <div class="in">
        <div class="gp-tab"></div>
        ${coverCfg.kicker ? `<div class="cv-kicker">${esc(coverCfg.kicker)}</div>` : ''}
        <div class="cv-mid">
          <h1 class="cv-title">${esc(B.title)}</h1>
          ${B.subtitle ? `<p class="cv-sub">${esc(B.subtitle)}</p>` : ''}
        </div>
        <div class="cv-bottom">
          <hr class="gp-rule">
          <div class="cv-meta">
            <span class="cv-author">${esc(B.author)}</span>
            <span class="cv-count">${esc(countWord(allTitles.length))}</span>
          </div>
          ${coverCfg.note ? `<p class="cv-note">${esc(coverCfg.note)}</p>` : ''}
        </div>
      </div>
    </section>`;

const copyrightLines = (copyCfg.lines || []).map((l) => `<p>${esc(l)}</p>`).join('\n          ');
const copyrightSection = `    <section class="sheet gp colophon">
      <div class="in">
        <div class="gp-tab"></div>
        <div class="cl-mid">
          <h2 class="cl-title">${esc(B.title)}</h2>
          ${B.subtitle ? `<p class="cl-sub">${esc(B.subtitle)}</p>` : ''}
          <hr class="gp-rule">
          <div class="cl-body">
            ${copyrightLines || ''}
            <p>${esc(copyCfg.rights || `© ${copyCfg.year || new Date().getFullYear()} ${B.author}. All rights reserved.`)}</p>
            <p>${esc(B.edition)}${B.brand ? ' · ' + esc(B.brand) : ''}</p>
          </div>
        </div>
        ${genFoot(B.edition)}
      </div>
    </section>`;

const dividerSection = (p, i) => {
  const items = p.titles.map((t, n) =>
    `<li>${B.numbered ? `<span class="n">${pad2(n + 1)}</span>` : ''}<span class="nm">${esc(t)}</span></li>`).join('\n            ');
  return `    <section class="sheet gp divider">
      <div class="in">
        <div class="gp-top">
          <div class="gp-tab"></div>
          <span class="gp-pill">Part ${i + 1} of ${parts.length}</span>
        </div>
        <div class="dv-mid">
          ${p.eyebrow ? `<div class="dv-eyebrow">${esc(p.eyebrow)}</div>` : ''}
          <div class="dv-num">${i + 1}</div>
          <h2 class="dv-name">${esc(p.name)}</h2>
          ${p.why ? `<p class="dv-why">${esc(p.why)}</p>` : ''}
          <hr class="gp-rule">
          <div class="dv-list-label">${esc(p.listLabel || 'In this part')}</div>
          <ol class="dv-list">
            ${items}
          </ol>
        </div>
        ${genFoot(B.edition)}
      </div>
    </section>`;
};

const tocPart = (p, i) => {
  const rows = p.titles.map((t) =>
    `<div class="toc-row"><span class="nm">${esc(t)}</span><span class="pg">${pageOf[t]}</span></div>`).join('\n            ');
  return `<div class="toc-part">
            <div class="toc-ph"><span class="pn">Part ${i + 1} · ${esc(p.name)}</span><span class="pg">${partPageOf.get(i)}</span></div>
            ${rows}
          </div>`;
};
const listPage = (cls, label, inner, withTitle) => `    <section class="sheet gp ${cls}">
      <div class="in">
        <div class="gp-top">
          <div class="gp-tab"></div>
          <span class="gp-pill">${esc(label)}</span>
        </div>
        ${withTitle
          ? `<h1 class="lp-title">${esc(label)}</h1>\n        <hr class="gp-rule">`
          : '<hr class="gp-rule" style="margin-top:15px">'}
        ${inner}
        ${genFoot(B.title)}
      </div>
    </section>`;

const contentsSections = tocBins.map((bin, i) =>
  listPage('toc', 'Contents',
    `<div class="toc-list">\n          ${bin.map((p) => tocPart(p, parts.indexOf(p))).join('\n          ')}\n        </div>`,
    i === 0));

const alpha = allTitles.slice().sort((a, b) =>
  a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
const perIndexPage = indexPages ? Math.ceil(alpha.length / indexPages) : 0;
const indexSections = [];
for (let i = 0; i < indexPages; i++) {
  const rows = alpha.slice(i * perIndexPage, (i + 1) * perIndexPage)
    .map((t) => `<div class="idx-row"><span class="nm">${esc(t)}</span><span class="pg">${pageOf[t]}</span></div>`)
    .join('\n            ');
  indexSections.push(listPage('index', 'Index',
    `<div class="idx">\n            ${rows}\n          </div>`, i === 0));
}

/* ------------------------------------------------- 6. chrome on the book pages
   The interior stays neutral, so a page can move between parts (or books)
   without being rewritten. The eyebrow number and the running foot are stamped
   here, at assembly, from book.json. */
const stampPage = (section, partName, nth) => {
  let s = section;
  const eyebrow = B.numbered
    ? `<b>${esc(B.series)}</b> · No. ${pad2(nth)}`
    : `<b>${esc(B.series)}</b>`;
  s = s.replace(/(<div class="eyebrow">)[\s\S]*?(<\/div>)/, `$1${eyebrow}$2`);
  s = s.replace(/(<span class="brand">)[^<]*(<\/span>)/, `$1${esc(B.brand)}$2`);
  s = s.replace(/(<span class="series">)[^<]*(<\/span>)/, `$1${esc(partName)}$2`);
  return s;
};

/* ------------------------------------------------------------ 7. the stylesheet
   Injected inline so it wins over the linked theme (later in the cascade), and
   so a built book is one portable file. */
let genCss = `    /* ====================================================================
       GENERATED PAGES — cover, copyright, contents, part dividers, index.
       Written by engine/tools/build-book.mjs. Scoped .sheet.gp so it can never
       touch a book page (.sheet.bb).
       ==================================================================== */
    .sheet.gp{
      --ink:#1A1A2E; --muted:#5B6472; --line:#E7E9EF;
      --accent:${B.accent}; --accent-strong:${B.accentStrong};
      padding:0; background:#FAFAFC; color:var(--ink);
      font-family:"Inter",system-ui,sans-serif;
    }
    .gp .in{ position:absolute; inset:0; display:flex; flex-direction:column; padding:13mm 15mm; }
    .gp .in > *{ flex-shrink:0; }
    /* flex:none, not a basis: .in is a column and .gp-top is a row, and a basis
       would be read as height in one and width in the other. */
    .gp-tab{ width:56px; height:7px; flex:none; border-radius:99px; background:var(--accent); }
    .gp-top{ display:flex; justify-content:space-between; align-items:center; gap:14px; }
    .gp-pill{
      font-size:12px; font-weight:500; color:#4B5563; background:#F1F2F6;
      border:1px solid var(--line); padding:5px 13px; border-radius:99px; white-space:nowrap;
    }
    .gp-rule{ height:1px; flex:0 0 1px; background:var(--line); border:0; margin:15px 0; }
    .gp-foot{
      display:flex; justify-content:space-between; align-items:center;
      font-size:12.5px; color:var(--muted); margin-top:auto; padding-top:13px;
      border-top:1px solid var(--line);
    }

    /* ---- cover ---- */
    .gp.cover .cv-kicker{
      font-size:13px; font-weight:600; letter-spacing:.18em; text-transform:uppercase;
      color:var(--accent-strong); margin-top:20px;
    }
    .gp.cover .cv-mid{ flex:1; display:flex; flex-direction:column; justify-content:center; }
    .gp.cover .cv-title{
      font-family:"Space Grotesk",sans-serif; font-size:64px; font-weight:700;
      line-height:1.02; letter-spacing:-.03em; margin:0; color:var(--ink);
    }
    .gp.cover .cv-sub{ font-size:22px; line-height:1.4; color:var(--muted); margin:18px 0 0; max-width:22em; }
    .gp.cover .cv-meta{ display:flex; justify-content:space-between; align-items:baseline; }
    .gp.cover .cv-author{ font-family:"Space Grotesk",sans-serif; font-size:19px; font-weight:600; color:var(--ink); }
    .gp.cover .cv-count{ font-size:14px; color:var(--muted); font-variant-numeric:tabular-nums; }
    .gp.cover .cv-note{ font-size:13.5px; color:var(--muted); margin:12px 0 0; }

    /* ---- copyright ---- */
    .gp.colophon .cl-mid{ flex:1; display:flex; flex-direction:column; justify-content:flex-end; }
    .gp.colophon .cl-title{ font-family:"Space Grotesk",sans-serif; font-size:27px; font-weight:600; letter-spacing:-.02em; margin:0; }
    .gp.colophon .cl-sub{ font-size:16px; color:var(--muted); margin:5px 0 0; }
    .gp.colophon .cl-body p{ font-size:13.5px; line-height:1.6; color:var(--muted); margin:0 0 8px; }

    /* ---- part divider ---- */
    .gp.divider .dv-mid{ flex:1; display:flex; flex-direction:column; justify-content:center; }
    .gp.divider .dv-eyebrow{
      font-size:12.5px; font-weight:600; letter-spacing:.18em; text-transform:uppercase;
      color:var(--accent-strong); margin:0;
    }
    .gp.divider .dv-num{
      font-family:"Space Grotesk",sans-serif; font-weight:700; font-size:78px;
      line-height:.92; letter-spacing:-.03em; color:var(--ink); margin:4px 0 0;
    }
    .gp.divider .dv-name{
      font-family:"Space Grotesk",sans-serif; font-weight:700; font-size:40px;
      line-height:1.05; letter-spacing:-.02em; color:var(--ink); margin:12px 0 0;
    }
    .gp.divider .dv-why{ font-size:17px; line-height:1.5; color:var(--muted); margin:12px 0 0; max-width:30em; }
    .gp.divider .dv-list-label{
      font-size:11.5px; font-weight:600; letter-spacing:.16em; text-transform:uppercase;
      color:var(--muted); margin:0 0 12px;
    }
    .gp.divider .dv-list{
      list-style:none; margin:0; padding:0;
      display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px 30px;
    }
    .gp.divider .dv-list li{ display:flex; align-items:baseline; gap:10px; }
    .gp.divider .dv-list .n{
      font-family:"Space Grotesk",sans-serif; font-weight:600; font-size:13px;
      color:var(--accent); font-variant-numeric:tabular-nums; min-width:1.6em;
    }
    .gp.divider .dv-list .nm{ font-size:15px; color:var(--ink); }

    /* ---- contents + index ---- */
    .gp .lp-title{ font-family:"Space Grotesk",sans-serif; font-size:30px; font-weight:600; letter-spacing:-.02em; margin:11px 0 0; }
    .gp.toc .toc-part{ margin-top:14px; }
    .gp.toc .toc-part:first-child{ margin-top:2px; }
    .gp.toc .toc-ph{ display:flex; align-items:baseline; gap:10px; line-height:1.4; }
    .gp.toc .toc-ph .pn{ flex:1; font-family:"Space Grotesk",sans-serif; font-size:14.5px; font-weight:600; color:var(--ink); }
    .gp.toc .toc-row{ display:flex; align-items:baseline; gap:12px; margin-top:6px; padding-left:3px; line-height:1.4; }
    .gp.toc .toc-row .nm{ flex:1; font-size:13.5px; color:var(--ink); }
    .gp .pg{ font-variant-numeric:tabular-nums; font-size:13px; color:var(--muted); }
    .gp.index .idx{ margin-top:4px; column-count:3; column-gap:22px; }
    .gp.index .idx-row{
      display:flex; align-items:baseline; gap:10px; break-inside:avoid;
      padding:2px 1px; border-bottom:1px solid #EFF1F5;
    }
    .gp.index .idx-row .nm{ flex:1; font-size:12px; color:var(--ink); }
    .gp.index .idx-row .pg{ font-size:12px; }

    /* ====================================================================
       ONE PAGE COUNTER for the whole book. Every sheet advances it; only the
       book pages print it, so a printed number is the real page in the PDF.
       Overrides the theme's page-only counter (inline wins over linked).
       ==================================================================== */
    .deck{ counter-reset:pageno; }
    .sheet.gp, .sheet.bb{ counter-increment:pageno; }
    .bb .foot .pg::before{ content:counter(pageno); }`;

/* ------------------------------------------------------ 7b. print craft
   Opt-in rules that are empty unless the matching flag was given, so a plain
   build is byte-identical. Both keep the screen layout (they are not scoped to
   @media print except the bleed page size, which is the point of bleed). */
let craftCss = '';
if (gutterMm > 0) {
  craftCss += `
    /* ---- GUTTER (--gutter ${gutterMm}mm): extra margin on the bound edge, so
       the spine does not eat the text. Odd sheets are recto (right-hand) and
       are bound on their left; even sheets are bound on their right. ---- */
    .deck > .sheet:nth-child(odd){ padding-left:calc(var(--page-pad) + ${gutterMm}mm); }
    .deck > .sheet:nth-child(even){ padding-right:calc(var(--page-pad) + ${gutterMm}mm); }`;
}
if (bleedMm > 0) {
  craftCss += `
    /* ---- BLEED (--bleed ${bleedMm}mm): the page prints ${bleedMm}mm larger than the
       trim on every side and the paper colour runs into that margin, so a
       guillotine cut cannot leave a white sliver. This is the ONE place a print
       rule changes a size, and only when --bleed is asked for. ---- */
    @media print{
      @page{ size:calc(var(--page-w) + ${bleedMm * 2}mm) calc(var(--page-h) + ${bleedMm * 2}mm); margin:0; }
      .deck > .sheet{ margin:${bleedMm}mm; box-shadow:0 0 0 ${bleedMm}mm var(--paper); }
    }`;
}
genCss += craftCss;

/* ------------------------------------------------------ 7c. right-to-left
   The dir="rtl" attribute flips the writing direction on its own. What it does
   not do is undo the handful of places the themes and the generated pages name a
   physical side, or stop letter-spacing from tearing Arabic letters apart. Empty
   unless dir="rtl", so nothing else changes. */
if (pageDir === 'rtl') {
  genCss += `
    /* ---- RTL (dir="rtl"): fix physical sides and protect cursive joining. ---- */
    html[dir="rtl"] .sheet.bb, html[dir="rtl"] .sheet.gp{ direction:rtl; }
    html[dir="rtl"] .sheet.bb *{ letter-spacing:normal !important; text-transform:none !important; }
    html[dir="rtl"] .bb .foot .brand{ text-align:right; }
    html[dir="rtl"] .bb .foot .series{ text-align:left; }
    html[dir="rtl"] .bb .explain table.ref td, html[dir="rtl"] .bb .explain table.ref th{ text-align:right; }
    html[dir="rtl"] .gp .toc-row, html[dir="rtl"] .gp .idx-row{ padding-left:0; padding-right:3px; }`;
}

/* ------------------------------------------------------------- 8. assemble */
const blankSection = `    <section class="sheet gp blank"><div class="in"></div></section>`;

const out = [coverSection, copyrightSection, ...contentsSections];
let nth = 0;   // the printed No. runs through the whole book, not per part
parts.forEach((p, i) => {
  if (startRecto && blankBeforePart.has(i)) out.push(blankSection);
  out.push(dividerSection(p, i));
  p.titles.forEach((t) => out.push(stampPage(pool.get(t), p.name, ++nth)));
});
indexSections.forEach((sec, k) => {
  if (startRecto && blankBeforeIndex.has(k)) out.push(blankSection);
  out.push(sec);
});

if (out.length !== totalPages)
  die(`Internal error: assembled ${out.length} pages but computed ${totalPages}.\n` +
      `Page numbers in the contents would be wrong, so nothing was written.`);

/* ---------------------------------------------------------------- trim + theme
   book.json may name a "size" and a "theme". When it does, the generated
   book.html is pointed at those files and the page is tagged with the size.

   When it does NOT — which is every book that shipped with this engine — the
   head is passed through completely untouched. That is deliberate and load
   bearing: the committed books were laid out for the stylesheets their own
   interior files already link, so a build with nothing to do must produce
   byte-identical output. engine/tools/regress.mjs exists to hold that line.
   Only swap a link that is actually there; never add or remove stylesheets. */
function applyLook(headHtml) {
  const sizeId = book.size || DEFAULTS.size;
  const themeId = book.theme || DEFAULTS.theme;
  let h = headHtml;

  const known = (id, kind) => {
    if (!DEFAULTS[kind][id]) die(`unknown ${kind} "${id}". Known: ${Object.keys(DEFAULTS[kind]).join(', ')}`);
  };
  if (book.size) known(book.size, 'sizes');
  if (book.theme) known(book.theme, 'themes');

  /* data-size on <html>. Only if the book asked for a different one. */
  if (book.size && !/data-size="/.test(h)) {
    die(`book.json asks for size "${book.size}" but the interior has no data-size attribute.\n` +
        `Add data-size="${book.size}" to the <html> tag in ${book.interior || slug}.`);
  }
  if (book.size) {
    h = h.replace(/data-size="[^"]*"/, `data-size="${sizeId}"`);
  }

  /* The size stylesheet. Replaced in place, so the order stays sheet.css, size,
     theme — which is what makes the @page override work. */
  if (book.size) {
    const want = `href="../../engine/sizes/${DEFAULTS.sizes[sizeId].file}"`;
    const re = /href="\.\.\/\.\.\/engine\/sizes\/[^"]*"/;
    if (!re.test(h)) {
      die(`no engine/sizes link in the interior. Cannot switch to size "${book.size}".`);
    }
    h = h.replace(re, want);
  }

  if (book.theme) {
    const want = `href="../../engine/themes/${DEFAULTS.themes[themeId].file}"`;
    const re = /href="\.\.\/\.\.\/engine\/themes\/[^"]*"/;
    if (!re.test(h)) {
      die(`no engine/themes link in the interior. Cannot switch to theme "${book.theme}".`);
    }
    h = h.replace(re, want);
  }

  /* ---- language + direction on <html>. Only when the book asked; the default
     English/LTR book keeps the exact <html> tag it shipped with. ---- */
  if (lang || pageDir) {
    h = h.replace(/<html\b[^>]*>/, (tag) => {
      let t = tag;
      if (lang) t = /\blang="/.test(t) ? t.replace(/\blang="[^"]*"/, `lang="${lang}"`) : t.replace('<html', `<html lang="${lang}"`);
      if (pageDir) t = /\bdir="/.test(t) ? t.replace(/\bdir="[^"]*"/, `dir="${pageDir}"`) : t.replace('<html', `<html dir="${pageDir}"`);
      return t;
    });
  }

  /* ---- script font packs. A pack.css rides under the theme's own family names
     with a unicode-range for its script, so nothing else has to change. ---- */
  if (fontPacks.length) {
    const links = fontPacks
      .map((id) => `  <link rel="stylesheet" href="../../engine/fonts/${PACKS[id].file}">`)
      .join('\n');
    h = h.replace('</head>', `${links}\n</head>`);
  }

  return h;
}

const injectedHead = applyLook(head).replace('</head>', `  <style>\n${genCss}\n  </style>\n</head>`);
const bookTitle = editionName ? `${B.title} — ${editionName} edition` : B.title;
const merged = (injectedHead + out.join('\n\n') + '\n' + tail)
  .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(bookTitle)}</title>`)
  .split('{{COUNT}}').join(String(allTitles.length));

fs.writeFileSync(outPath, merged);

const rel = path.relative(process.cwd(), outPath).replace(/\\/g, '/');
const craft = [
  gutterMm > 0 ? `gutter ${gutterMm}mm` : '',
  bleedMm > 0 ? `bleed ${bleedMm}mm` : '',
  startRecto ? 'recto starts' : '',
].filter(Boolean);
console.log(`wrote ${out.length} pages to ${rel}`);
console.log(`  ${countWord(allTitles.length)} in ${parts.length} part${parts.length > 1 ? 's' : ''}` +
            `, cover + copyright` +
            (contentsPages ? ` + contents×${contentsPages}` : '') +
            (indexPages ? ` + index×${indexPages}` : '') +
            (editionName ? `  [${editionName} edition]` : '') +
            (craft.length ? `  [${craft.join(', ')}]` : ''));
console.log(`\nNext: node engine/tools/check.mjs ${rel}`);
