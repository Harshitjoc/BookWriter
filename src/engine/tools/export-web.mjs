/* ==========================================================================
   export-web.mjs  -  one HTML file you can open anywhere, offline
   --------------------------------------------------------------------------
   The book, as a single portable file: every stylesheet inlined, every photo
   turned into a data URI, and a small reading bar on top so you can jump from
   page to page. No server, no assets folder, no network — email it, drop it on
   a USB stick, open it from anywhere.

   Usage:
       node src/engine/tools/export-web.mjs books/<slug>/book.html
       node src/engine/tools/export-web.mjs books/<slug>/book.html --out out.html
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const input = argv.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('Usage: node src/engine/tools/export-web.mjs <book.html> [--out <file.html>] [--json]');
  process.exit(1);
}
const flag = (name) => { const i = argv.indexOf('--' + name); return i === -1 ? null : argv[i + 1]; };
const asJson = argv.includes('--json');

const abs = path.resolve(input);
const bookDir = path.dirname(abs);
const outPath = path.resolve(flag('out') || path.join(bookDir, 'book-web.html'));
let html = fs.readFileSync(abs, 'utf8');

const titleTag = html.match(/<title>([\s\S]*?)<\/title>/);
const bookTitle = titleTag ? titleTag[1].trim() : path.basename(bookDir);

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
const fileToDataUri = (file) => {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
};

/* ---- give every sheet an id, and collect a table of pages ----------------
   This runs BEFORE the stylesheets are inlined: the engine's CSS carries example
   <section class="sheet ..."> markup in its comments, and counting after inlining
   would mistake those for pages. The interior's HTML comments are blanked too. */
const scan = html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
const opens = [...scan.matchAll(/<section\s+class="([^"]*\bsheet\b[^"]*)"[^>]*>/gi)];
const pages = opens.map((m, i) => ({ n: i + 1, title: '' }));
for (let i = opens.length - 1; i >= 0; i--) {
  const at = opens[i].index + '<section'.length;
  html = html.slice(0, at) + ` id="pg-${i + 1}"` + html.slice(at);
}

/* ---- inline every local stylesheet --------------------------------------- */
let inlinedCss = 0;
html = html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi, (tag) => {
  const m = tag.match(/href="([^"]+)"/);
  if (!m || /^(https?:|data:)/.test(m[1])) return tag;
  const file = path.resolve(bookDir, m[1]);
  if (!fs.existsSync(file)) return tag;
  inlinedCss += 1;
  return `<style data-from="${m[1]}">\n${fs.readFileSync(file, 'utf8')}\n</style>`;
});

/* ---- inline every local image -------------------------------------------- */
let inlinedImg = 0;
html = html.replace(/<img\b[^>]*>/gi, (tag) => {
  const m = tag.match(/\bsrc="([^"]+)"/);
  if (!m || /^(https?:|data:)/.test(m[1])) return tag;
  const file = path.resolve(bookDir, m[1]);
  if (!fs.existsSync(file)) return tag;
  inlinedImg += 1;
  return tag.replace(m[1], fileToDataUri(file));
});

/* The titles live inside each sheet, so read them out for the reading bar. */
for (const p of pages) {
  const at = html.indexOf(`id="pg-${p.n}"`);
  const chunk = html.slice(at, html.indexOf('</section>', at));
  const t = chunk.match(/<h1 class="title">([\s\S]*?)<\/h1>/) ||
            chunk.match(/<h1 class="lp-title">([\s\S]*?)<\/h1>/) ||
            chunk.match(/<h1 class="cv-title">([\s\S]*?)<\/h1>/);
  if (t) p.title = t[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

const options = pages.map((p) => `        <option value="pg-${p.n}">${p.n}. ${escapeHtml(p.title)}</option>`).join('\n');

const readerCss = `
/* == export-web reader chrome (added by export-web.mjs) == */
body{ background:#E9EBF1; margin:0; padding-top:52px; }
.reader-bar{ position:fixed; inset:0 0 auto 0; height:52px; z-index:9999; display:flex;
  align-items:center; gap:14px; padding:0 18px; background:#141821; color:#E6E8EE;
  font-family:"Inter",system-ui,sans-serif; box-shadow:0 1px 0 rgba(0,0,0,.25); }
.reader-bar .rb-title{ font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.reader-bar .rb-spacer{ flex:1; }
.reader-bar select{ font:inherit; font-size:13px; padding:5px 9px; border-radius:7px;
  border:1px solid #2A3140; background:#1D232E; color:#E6E8EE; max-width:46vw; }
.reader-bar button{ font:inherit; font-size:13px; padding:5px 11px; border-radius:7px; cursor:pointer;
  border:1px solid #2A3140; background:#1D232E; color:#E6E8EE; }
.reader-bar button:hover{ background:#262E3C; }
.reader-bar .rb-count{ font-size:12px; color:#98A0B0; }
@media print{ .reader-bar{ display:none } body{ padding-top:0; background:#fff } }
`;

const bar = `  <div class="reader-bar">
    <span class="rb-title">${escapeHtml(bookTitle)}</span>
    <span class="rb-spacer"></span>
    <button id="rb-prev" aria-label="Previous page">&#8592;</button>
    <select id="rb-jump" aria-label="Jump to page">
      <option value="">Jump to…</option>
${options}
    </select>
    <button id="rb-next" aria-label="Next page">&#8594;</button>
    <span class="rb-count" id="rb-count"></span>
  </div>
  <script>
  (function(){
    var ids = ${JSON.stringify(pages.map((p) => 'pg-' + p.n))};
    var sel = document.getElementById('rb-jump');
    var count = document.getElementById('rb-count');
    function at(){ var y = window.scrollY + 60; for (var i = 0; i < ids.length; i++){ var el = document.getElementById(ids[i]); if (el && el.offsetTop + el.offsetHeight > y) return i; } return ids.length - 1; }
    function go(i){ i = Math.max(0, Math.min(ids.length - 1, i)); var el = document.getElementById(ids[i]); if (el) el.scrollIntoView({ behavior:'smooth', block:'start' }); }
    function sync(){ var i = at(); sel.value = ids[i]; if (count) count.textContent = (i + 1) + ' / ' + ids.length; }
    sel.addEventListener('change', function(){ if (sel.value) go(ids.indexOf(sel.value)); });
    document.getElementById('rb-prev').addEventListener('click', function(){ go(at() - 1); });
    document.getElementById('rb-next').addEventListener('click', function(){ go(at() + 1); });
    window.addEventListener('scroll', function(){ requestAnimationFrame(sync); }, { passive:true });
    window.addEventListener('keydown', function(e){ if (e.key === 'ArrowRight' || e.key === 'PageDown'){ go(at() + 1); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp'){ go(at() - 1); } });
    sync();
  })();
  </script>
`;

if (/<\/body>/i.test(html)) {
  html = html.replace(/<\/head>/i, `  <style>${readerCss}</style>\n</head>`);
  html = html.replace(/<body([^>]*)>/i, `<body$1>\n${bar}`);
  html = html.replace(/<\/body>/i, `</body>`);
} else {
  html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(bookTitle)}</title><style>${readerCss}</style></head><body>${bar}${html}</body></html>`;
}

fs.writeFileSync(outPath, html);
const rel = path.relative(process.cwd(), outPath).replace(/\\/g, '/');
if (asJson) {
  console.log(JSON.stringify({ out: rel, pages: pages.length, inlinedCss, inlinedImg, bytes: Buffer.byteLength(html) }));
} else {
  console.log(`wrote ${rel}  (${pages.length} pages, ${inlinedCss} stylesheets + ${inlinedImg} images inlined, ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB)`);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
