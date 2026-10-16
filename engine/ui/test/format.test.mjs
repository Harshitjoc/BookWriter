/* ==========================================================================
   test/format.test.mjs  -  trims and themes, from the command line
   --------------------------------------------------------------------------
   The rule this file defends: a book that says nothing about its size or theme
   must build to exactly the same bytes it always did. Everything here is
   additive, and the first group is the one that would catch it if it stopped
   being additive.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { group, ok, report, cli, scratchBook, cleanStale, ROOT } from './harness.mjs';
import { extractSection, validate } from '../../tools/draft-block.mjs';

const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', 'defaults.json'), 'utf8'));
cleanStale();

const build = (b) => cli('build-book.mjs', `books/${b.slug}`);
const check = (b) => {
  const r = cli('check.mjs', path.join('books', b.slug, 'book.html'), '--json');
  let json = null;
  try { json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { /* reported below */ }
  return { ...r, json };
};

group('the defaults are still the ones this engine shipped with');
ok('b5 is the default size', DEFAULTS.size === 'b5');
ok('studio is the default theme', DEFAULTS.theme === 'studio');
ok('standard is the default archetype', DEFAULTS.archetype === 'standard');
ok('every advertised size has a real stylesheet',
  Object.values(DEFAULTS.sizes).every((s) => fs.existsSync(path.join(ROOT, 'engine', 'sizes', s.file))),
  Object.entries(DEFAULTS.sizes).filter(([, s]) => !fs.existsSync(path.join(ROOT, 'engine', 'sizes', s.file))).map(([k]) => k).join(','));
ok('every size file sets a width, a height and a page rule',
  Object.values(DEFAULTS.sizes).every((s) => {
    const css = fs.readFileSync(path.join(ROOT, 'engine', 'sizes', s.file), 'utf8');
    return /--page-w/.test(css) && /--page-h/.test(css) && /@page/.test(css);
  }));
ok('a size file only ever sets trim, never layout',
  Object.values(DEFAULTS.sizes).every((s) => {
    const css = fs.readFileSync(path.join(ROOT, 'engine', 'sizes', s.file), 'utf8');
    /* A size file that started restyling text or the diagram would break the
       "one stylesheet drives screen and print" rule from the other side. */
    return !/font-family|font-size\s*:|color\s*:/.test(css);
  }));

group('every advertised theme has a real stylesheet that keeps the layout');
ok('every theme has a stylesheet',
  Object.values(DEFAULTS.themes).every((t) => fs.existsSync(path.join(ROOT, 'engine', 'themes', t.file))),
  Object.entries(DEFAULTS.themes).filter(([, t]) => !fs.existsSync(path.join(ROOT, 'engine', 'themes', t.file))).map(([k]) => k).join(','));
ok('no theme restates the trim or adds a page rule',
  Object.values(DEFAULTS.themes).every((t) => {
    const css = fs.readFileSync(path.join(ROOT, 'engine', 'themes', t.file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');       // comments describe things, they do not do them
    /* "size:" alone would match "font-size:", which is not what this is about. */
    return !/--page-[wh]|@page/.test(css);
  }));
/* studio is exempt: it IS the anatomy, padding included. The rule is that no
   *other* theme may change the box, because a theme that resizes the page is a
   different engine. `line-height` must not be read as `height`, hence the
   property-name anchor: only a real declaration counts. */
const RESIZES_THE_BOX = /\.sheet[^{]*\{[^}]*(?:^|[;{\s])(?:width|height|padding)\s*:/;
const resizesBox = (id, t) => {
  if (id === 'studio') return false;
  return RESIZES_THE_BOX.test(
    fs.readFileSync(path.join(ROOT, 'engine', 'themes', t.file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
};
ok('no other theme touches the sheet box itself',
  Object.entries(DEFAULTS.themes).every(([id, t]) => !resizesBox(id, t)),
  Object.entries(DEFAULTS.themes).filter(([id, t]) => resizesBox(id, t)).map(([id]) => id).join(','));
ok('a theme does not smuggle the page box in through a child selector either',
  Object.entries(DEFAULTS.themes).every(([id, t]) => {
    if (id === 'studio') return true;
    const css = fs.readFileSync(path.join(ROOT, 'engine', 'themes', t.file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    return !/\.sheet\b[^{]*\{[^}]*(?:^|[;{\s])(?:width|height|padding)\s*:/.test(css);
  }));
ok('no theme writes its own @media print rule',
  Object.values(DEFAULTS.themes).every((t) =>
    !/@media\s+print/.test(fs.readFileSync(path.join(ROOT, 'engine', 'themes', t.file), 'utf8'))),
  Object.entries(DEFAULTS.themes).filter(([, t]) =>
    /@media\s+print/.test(fs.readFileSync(path.join(ROOT, 'engine', 'themes', t.file), 'utf8'))).map(([k]) => k).join(','));
/* studio.css is the one stylesheet the committed books were laid out against.
   It must not change, ever, without re-checking every book in books/. */
ok('studio.css is unchanged and still defines the page anatomy',
  /\.sheet\.bb\{/.test(fs.readFileSync(path.join(ROOT, 'engine', 'themes', 'studio.css'), 'utf8')) &&
  /\.bb \.explain\{/.test(fs.readFileSync(path.join(ROOT, 'engine', 'themes', 'studio.css'), 'utf8')));

group('a book that says nothing is untouched');
{
  const b = scratchBook('fmtdefault');
  try {
    const r = build(b);
    ok('it builds', r.code === 0, r.stderr.split('\n')[0]);
    const html = fs.readFileSync(path.join(b.dir, 'book.html'), 'utf8');
    ok('it stays on B5', /data-size="b5"/.test(html) && /sizes\/b5\.css/.test(html));
    ok('it stays on studio', /themes\/studio\.css/.test(html));
    ok('the built bytes match the committed starter exactly',
      fs.readFileSync(path.join(b.dir, 'book.html'), 'utf8') ===
      fs.readFileSync(path.join(ROOT, 'books', 'starter', 'book.html'), 'utf8'));
  } finally { b.drop(); }
}

group('every trim builds, links itself, and measures itself');
for (const [id, spec] of Object.entries(DEFAULTS.sizes)) {
  const b = scratchBook('fmt' + id.replace(/[^a-z]/g, ''), { size: id });
  try {
    const r = build(b);
    ok(`${id} builds`, r.code === 0, r.stderr.split('\n')[0]);
    const html = fs.readFileSync(path.join(b.dir, 'book.html'), 'utf8');

    ok(`${id} tags the page with its own data-size`, new RegExp(`data-size="${id}"`).test(html));
    ok(`${id} links its own stylesheet`, new RegExp(`sizes/${spec.file.replace('.', '\\.')}"`).test(html));
    ok(`${id} keeps sheet.css first, then size, then theme`,
      html.indexOf('sheet.css') < html.indexOf(`sizes/${spec.file}`) &&
      html.indexOf(`sizes/${spec.file}`) < html.indexOf('themes/'));

    const c = check(b);
    ok(`${id} check returns JSON`, !!c.json, c.stderr.split('\n')[0]);
    if (c.json) {
      /* The point of the whole exercise: check.mjs reads the trim off the page
         instead of assuming B5. */
      ok(`${id} is measured as ${spec.w} x ${spec.h} mm`,
        Math.abs(c.json.trim.widthMm - spec.w) < 1 && Math.abs(c.json.trim.heightMm - spec.h) < 1,
        c.json.trim ? `${c.json.trim.size} ${c.json.trim.widthMm} x ${c.json.trim.heightMm}` : 'no trim');
      ok(`${id} reports its own name`, c.json.trim?.size === id, c.json.trim?.size);
    }
  } finally { b.drop(); }
}

group('a smaller trim really does catch a page that no longer fits');
{
  /* B5 is 176x250. A5 is 148x210. The same page cannot fit both. If check.mjs
     reported 0 mm on A5 it would be measuring nothing, and the whole gate would
     be decorative. */
  const b = scratchBook('fmtsmaller', { size: 'a5' });
  try {
    build(b);
    const c = check(b);
    const over = c.json?.overflowing || [];
    ok('the B5 page overflows on A5 and check says by how much',
      c.code === 1 && over.length > 0 && over[0].overMm > 0,
      c.json ? `+${over[0]?.overMm}mm on ${over.length} page(s)` : 'no JSON');
    ok('the advice is to cut words, not to resize the drawing',
      /cut/i.test(c.stdout + c.stderr) || c.json?.overflowing?.length > 0);
  } finally { b.drop(); }
}

group('themes swap the same way, and stay cosmetic');
for (const [id, spec] of Object.entries(DEFAULTS.themes)) {
  if (id === 'studio') continue;                 // covered by "says nothing is untouched"
  const b = scratchBook('fmt' + id, { theme: id });
  try {
    const r = build(b);
    ok(`${id} builds`, r.code === 0, r.stderr.split('\n')[0]);
    const html = fs.readFileSync(path.join(b.dir, 'book.html'), 'utf8');
    ok(`${id} links its own stylesheet`, new RegExp(`themes/${spec.file.replace('.', '\\.')}"`).test(html));
    ok(`${id} keeps the B5 trim`, /sizes\/b5\.css/.test(html) && /data-size="b5"/.test(html));

    const c = check(b);
    ok(`${id} still fits the page that fit in studio`,
      c.json?.ready === true,
      c.json?.overflowing?.map((o) => `+${o.overMm}mm`).join(',') || c.stderr.split('\n')[0]);
    ok(`${id} measured the right trim`, c.json?.trim?.size === 'b5', c.json?.trim?.size);
    ok(`${id} is styled, not unstyled`, c.json?.unstyled === false);

    /* Two themes must actually look different, or there is no point having two. */
    ok(`${id} defines its own accent colour`,
      /--accent:\s*#/.test(fs.readFileSync(path.join(ROOT, 'engine', 'themes', spec.file), 'utf8')));
  } finally { b.drop(); }
}
{
  /* Two themes that differ only in whitespace are one theme with two names. */
  const accents = Object.entries(DEFAULTS.themes).map(([id, s]) => [
    id,
    /--accent:\s*(#[0-9A-Fa-f]{6})/.exec(
      fs.readFileSync(path.join(ROOT, 'engine', 'themes', s.file), 'utf8'))[1].toLowerCase(),
  ]);
  ok('every theme has its own accent colour',
    new Set(accents.map(([, hex]) => hex)).size === accents.length,
    accents.map(([id, hex]) => `${id}=${hex}`).join(' '));
}

group('a page shaped as an archetype is still a page that fits');
{
  /* Each archetype adds a specific block to .explain, and the themes have to
     style every one of them. The only honest proof those blocks belong on the
     page is that a page carrying them still measures 0 mm, so each shape is
     built for real and measured. */
  const SHAPES = {
    procedure: '<div class="explain">\n      <ol><li>Open the settings page.</li>'
      + '<li>Turn on the second toggle.</li><li>Save, then reload.</li></ol>\n'
      + '      <p class="close">The toggle is on.</p>\n    </div>',
    recipe: '<div class="explain">\n      <ul><li>2 tbsp miso</li><li>Broth at 80C, not boiling</li></ul>\n'
      + '      <ol><li>Warm the broth.</li><li>Whisk the miso in off the heat.</li></ol>\n'
      + '      <p class="close">Off the heat, or it splits.</p>\n    </div>',
    exercise: '<div class="explain">\n      <p><span class="hl">Goal: cap every client at ten calls a minute.</span></p>\n'
      + '      <ol><li>Count the calls per key.</li><li>Return 429 past ten.</li></ol>\n'
      + '      <p class="close">The eleventh call is refused.</p>\n    </div>',
    reference: '<div class="explain">\n      <table class="ref">'
      + '<caption>The three limits, in full.</caption>'
      + '<tr><th>Limit</th><th>Default</th><th>Scope</th></tr>'
      + '<tr><td>Body</td><td>10 MB</td><td>per request</td></tr>'
      + '<tr><td>Rate</td><td>100/min</td><td>per key</td></tr></table>\n'
      + '      <p class="close">Read the scope column first.</p>\n    </div>',
  };

  const PAGE = extractSection(fs.readFileSync(
    path.join(ROOT, 'books', 'starter', 'starter.html'), 'utf8'));

  for (const [id, explain] of Object.entries(SHAPES)) {
    for (const theme of Object.keys(DEFAULTS.themes)) {
      /* "theme: studio" is not passed here: studio is the default, and naming the
         default asks applyLook to swap a link the starter does not have. What is
         under test is the shape, not the swap. */
      /* "theme: studio" is not passed here: studio is the default, and naming the
         default asks applyLook to swap a link the starter does not have. What is
         under test is the shape, not the swap. */
      const b = scratchBook(`shape${id}${theme}`, theme === 'studio' ? {} : { theme });
      try {
        /* Re-shape the engine's own page rather than inventing one: the title,
           diagram, action box and footer are the real thing, so what gets
           measured is the new .explain block and nothing else. */
        const page = PAGE
          .replace('<section class="sheet bb"', `<section class="sheet bb" data-archetype="${id}"`)
          .replace(/<div class="explain">[\s\S]*?<\/div>/, explain);
        ok(`${id}/${theme}: the fixture carries its shape and its hook`,
          page.includes(`data-archetype="${id}"`) && page.includes(explain.slice(0, 48)));

        /* Replace the book's pages with just this one, so a failure names the
           shape rather than whatever else happens to be in the starter.

           The <main> element is matched non-greedily and only within <body>:
           a greedy match to the last </main> in the file also swallows the head,
           and the build then fails for a missing stylesheet link, which is a
           misleading way to learn that a fixture was written too widely. */
        const interior = b.interior;
        const head = fs.readFileSync(interior, 'utf8').slice(0, fs.readFileSync(interior, 'utf8').indexOf('<body>'));
        const body = fs.readFileSync(interior, 'utf8')
          .replace(/<body>[\s\S]*<\/main>/, `<body>\n  <main class="deck">\n    ${page}\n  </main>`);
        fs.writeFileSync(interior, head + body);
        ok(`${id}/${theme}: the fixture kept its stylesheets`,
          (head + body).includes('engine/themes/') && (head + body).includes('engine/sizes/'));

        const built = build(b);
        ok(`${id}/${theme}: it builds`, built.code === 0, built.stderr.split('\n').find((l) => l.trim()) || '');
        const c = check(b);
        ok(`${id}/${theme}: it still fits the page`, c.json?.ready === true,
          c.json?.overflowing?.map((o) => `+${o.overMm}mm`).join(',') || c.stderr.split('\n')[0]);
        ok(`${id}/${theme}: it is styled, not unstyled`, c.json?.unstyled === false);
      } finally { b.drop(); }
    }
  }
}

group('mistakes are refused, not guessed');
{
  const b = scratchBook('fmtbad', { size: 'a3' });
  try {
    const r = build(b);
    ok('an unknown size stops the build', r.code === 1);
    ok('and it lists the sizes that do exist',
      /Known:/.test(r.stderr) && /a5/.test(r.stderr) && /six-by-nine/.test(r.stderr),
      r.stderr.replace(/\s+/g, ' ').slice(0, 100));
    ok('nothing was written', !fs.existsSync(path.join(b.dir, 'book.html')));
  } finally { b.drop(); }
}
{
  const b = scratchBook('fmtnotlink', { size: 'a5' });
  try {
    /* Remove the size link, then ask for a different size. Swapping a link that
       is not there would mean inventing a stylesheet, which is how a book ends
       up unstyled on paper. */
    fs.writeFileSync(b.interior,
      fs.readFileSync(b.interior, 'utf8').replace(/\s*<link rel="stylesheet" href="\.\.\/\.\.\/engine\/sizes\/[^"]*">/, ''));
    const r = build(b);
    ok('a book with no size link cannot be resized', r.code === 1);
    ok('and it says why', /no engine\/sizes link/.test(r.stderr), r.stderr.replace(/\s+/g, ' ').slice(0, 90));
  } finally { b.drop(); }
}

report('format');