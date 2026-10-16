/* ==========================================================================
   lib/book-html.mjs  -  read a built book.html, pull it apart
   --------------------------------------------------------------------------
   A built book.html is one file: a head, then a run of <section class="sheet
   gp ..."> generated pages and <section class="sheet bb"> book pages, then a
   tail. Every exporter needs the same three things from it — the sheets, each
   sheet's title, and the images it references — so they live here once.

   splitSheets(html)      -> [ { html, cls, title, isBook } ]
   headOf(html)           -> everything up to the first sheet
   collectImages(sheets)  -> [ 'images/foo.jpg', ... ]  (unique, in order)
   xhtmlSafe(fragment)    -> a fragment an XML parser will accept
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/** All sheets, in order, with their class list and best-guess title. */
export function splitSheets(html) {
  const scan = html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  const OPEN = /<section\s+class="([^"]*\bsheet\b[^"]*)"[^>]*>/g;
  const opens = [...scan.matchAll(OPEN)];
  if (!opens.length) return [];
  const closeIdx = scan.lastIndexOf('</section>') + '</section>'.length;
  const sheets = [];
  for (let i = 0; i < opens.length; i++) {
    const start = opens[i].index;
    const end = i + 1 < opens.length ? opens[i + 1].index : closeIdx;
    const cls = opens[i][1];
    const inner = html.slice(start, end);
    sheets.push({ html: inner, cls, title: titleOf(inner), isBook: /\bbb\b/.test(cls) });
  }
  return sheets;
}

/** The heading a sheet is known by: the book page title, else the cover title. */
export function titleOf(sheetHtml) {
  const m = sheetHtml.match(/<h1 class="title">([\s\S]*?)<\/h1>/) ||
            sheetHtml.match(/<h1 class="lp-title">([\s\S]*?)<\/h1>/) ||
            sheetHtml.match(/<h1 class="cv-title">([\s\S]*?)<\/h1>/) ||
            sheetHtml.match(/<h2 class="dv-name">([\s\S]*?)<\/h2>/) ||
            sheetHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return stripTags(m ? m[1] : '') || 'Untitled';
}

export function headOf(html) {
  /* Comments are blanked first: an interior file (and the engine CSS it links)
     shows example page markup, and that must not be mistaken for a page. */
  const scan = html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  const i = scan.search(/<section\s+class="[^"]*\bsheet\b/);
  return i === -1 ? html : html.slice(0, i);
}

/** Unique image srcs in document order, restricted to book-relative files. */
export function collectImages(sheets) {
  const seen = new Set();
  const out = [];
  for (const s of sheets) {
    const re = /<img\b[^>]*\bsrc="([^"]+)"/g;
    let m;
    while ((m = re.exec(s.html))) {
      const src = m[1];
      if (/^(https?:|data:)/.test(src)) continue;
      if (seen.has(src)) continue;
      seen.add(src);
      out.push(src);
    }
  }
  return out;
}

/* Named entities the books use that XHTML does not define, mapped to numeric
   refs. XHTML knows only amp/lt/gt/quot/apos, so anything else has to go. */
const NAMED = {
  nbsp: 160, copy: 169, reg: 174, trade: 8482, deg: 176, middot: 183,
  mdash: 8212, ndash: 8211, hellip: 8230, lsquo: 8216, rsquo: 8217,
  ldquo: 8220, rdquo: 8221, laquo: 171, raquo: 187, times: 215,
  divide: 247, sup2: 178, sup3: 179, frac12: 189, frac14: 188,
  frac34: 190, bull: 8226, dagger: 8224, rarr: 8594, larr: 8592,
  harr: 8596, uarr: 8593, darr: 8595,
};
const VOID = 'area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr';

/** Make an HTML fragment safe to drop inside an XHTML document. */
export function xhtmlSafe(fragment) {
  let s = fragment;
  s = s.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (whole, name) => {
    if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(name)) return whole;
    return NAMED[name] != null ? `&#${NAMED[name]};` : `&amp;${name};`;
  });
  /* Bare ampersands that start no entity. */
  s = s.replace(/&(?!#\d+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/g, '&amp;');
  /* Self-close void elements, without touching ones already closed. */
  s = s.replace(new RegExp(`<(${VOID})\\b([^>]*?)(/?)>`, 'gi'),
    (whole, tag, attrs, slash) => (slash ? whole : `<${tag}${attrs}/>`));
  return s;
}

export function readBookHtml(file) {
  return fs.readFileSync(file, 'utf8');
}

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

/** Inline every local <link rel=stylesheet> and <img> so the file stands alone. */
export function inlineLocalAssets(html, bookDir) {
  let inlinedCss = 0, inlinedImg = 0;
  let out = html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi, (tag) => {
    const m = tag.match(/href="([^"]+)"/);
    if (!m || /^(https?:|data:)/.test(m[1])) return tag;
    const file = path.resolve(bookDir, m[1]);
    if (!fs.existsSync(file)) return tag;
    inlinedCss += 1;
    return `<style data-from="${m[1]}">\n${fs.readFileSync(file, 'utf8')}\n</style>`;
  });
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const m = tag.match(/\bsrc="([^"]+)"/);
    if (!m || /^(https?:|data:)/.test(m[1])) return tag;
    const file = path.resolve(bookDir, m[1]);
    if (!fs.existsSync(file)) return tag;
    inlinedImg += 1;
    const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return tag.replace(m[1], `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`);
  });
  return { html: out, inlinedCss, inlinedImg };
}
