/* ==========================================================================
   test/templates.test.mjs  -  the scaffold catalog
   --------------------------------------------------------------------------
   Run:  node tests/templates.test.mjs

   Two layers, because there are two ways a template can be wrong:

     1. on disk   a catalog entry that points at a folder that is not a
                  complete, buildable book
     2. through the cockpit  a picker that offers a template the server
                  cannot actually copy, or a copy that does not build

   The end-to-end pass scaffolds every template through /api/new-book into a
   throwaway book, builds and checks it, and deletes it. That is the exact path
   a person takes from the picker, so it is the one worth asserting.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { group, ok, report, withServer, runTool, cleanStale, ROOT } from './harness.mjs';
import { listTemplates, templateById, DEFAULT_TEMPLATE_ID } from '../src/engine/tools/templates.mjs';
import { renderCast, renderCastRow, CAST_IDS } from '../src/engine/tools/cast.mjs';

const IDS = ['starter', 'cookbook', 'manual', 'reference', 'field-guide', 'memoir'];
const SCAFFOLDS = IDS.map((id) => `tpl-${id}`);

/* A crashed run must not leave a scaffolded book in the next run's listing. */
cleanStale(...SCAFFOLDS);

const post = (base, p, body) =>
  fetch(`${base}${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

/* ---------------------------------------------------------------- on disk */
group('the catalog');

const cat = listTemplates();
ok('offers every named template', IDS.every((id) => cat.some((t) => t.id === id)),
  cat.map((t) => t.id).join(', '));
ok('starter is the default', DEFAULT_TEMPLATE_ID === 'starter', DEFAULT_TEMPLATE_ID);
ok('no duplicate ids', new Set(cat.map((t) => t.id)).size === cat.length);
ok('every catalog folder exists', cat.every((t) => t.exists),
  cat.filter((t) => !t.exists).map((t) => t.id).join(', '));

group('every template is a complete book on disk');
for (const id of IDS) {
  const t = templateById(id);
  /* starter carries its metadata inline in templates.mjs, so it is the one
     template with no template.json. Everything else ships one. */
  const need = id === 'starter'
    ? ['book.json', 'starter.html', 'VOICE.md', 'blocks.md']
    : ['book.json', `${id}.html`, 'template.json', 'VOICE.md', 'blocks.md'];
  const missing = need.filter((f) => !fs.existsSync(path.join(t.dir, f)));
  ok(`${id}: has ${need.length} source files`, missing.length === 0, missing.join(', '));

  /* The picker's label must not lie about what it will copy. For the named
     templates the theme and size live in template.json and are authoritative. */
  if (id !== 'starter') {
    const declared = JSON.parse(fs.readFileSync(path.join(t.dir, 'template.json'), 'utf8'));
    ok(`${id}: template.json agrees with the catalog`,
      declared.theme === t.theme && declared.size === t.size,
      `${declared.theme}/${declared.size} vs ${t.theme}/${t.size}`);
    const cfg = JSON.parse(fs.readFileSync(path.join(t.dir, 'book.json'), 'utf8'));
    ok(`${id}: book.json agrees with template.json`,
      cfg.theme === declared.theme && cfg.size === declared.size,
      `${cfg.theme}/${cfg.size}`);
  }
}

/* -------------------------------------------------------------- the cast */
group('the original cast');
ok('renders a character as one <svg>', /^<svg[\s\S]*<\/svg>$/.test(renderCast('pip').trim()));
ok('renders a row of characters', renderCastRow(CAST_IDS).startsWith('<svg'));
ok('an unknown character is refused', (() => {
  try { renderCast('mickey'); return false; } catch { return true; }
})());
/* Callers add their own labels. A drawing that carried stray <text> would risk
   inheriting its way to invisible, which the house rules forbid. */
ok('every drawing is text-free', CAST_IDS.every((id) => !/<text/.test(renderCast(id))));

/* -------------------------------------------------------- through the API */
await withServer(async (base) => {
  try {
    group('GET /api/templates');
    const j = await (await fetch(`${base}/api/templates`)).json();
    ok('reports the default id', j.default === 'starter', j.default);
    ok('lists every template', IDS.every((id) => j.templates.some((t) => t.id === id)));

    group('every template scaffolds and passes check');
    for (const id of IDS) {
      const slug = `tpl-${id}`;
      const r = await (await post(base, '/api/new-book', { slug, template: id })).json();
      ok(`${id}: scaffolded through the API`, r.ok === true && r.template === id, JSON.stringify(r));
      ok(`${id}: interior renamed to the slug`,
        fs.existsSync(path.join(ROOT, 'books', slug, `${slug}.html`)));
      ok(`${id}: no generated book.html rode along`,
        !fs.existsSync(path.join(ROOT, 'books', slug, 'book.html')));

      const b = await runTool(base, 'build', slug);
      const c = await runTool(base, 'check', slug);
      ok(`${id}: builds and reads 0 mm`,
        b.code === 0 && c.code === 0 && c.result?.ready === true,
        `pages=${b.result?.pages ?? '?'} ready=${c.result?.ready}`);
    }

    group('an unknown template is refused, never silently defaulted');
    const bad = await post(base, '/api/new-book', { slug: 'tpl-bogus', template: 'nope' });
    ok('unknown template is a 400', bad.status === 400, `HTTP ${bad.status}`);
    ok('and nothing was written', !fs.existsSync(path.join(ROOT, 'books', 'tpl-bogus')));
  } finally {
    for (const slug of [...SCAFFOLDS, 'tpl-bogus']) {
      fs.rmSync(path.join(ROOT, 'books', slug), { recursive: true, force: true });
    }
  }
});

report('templates');
