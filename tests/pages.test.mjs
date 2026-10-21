/* ==========================================================================
   test/pages.test.mjs  —  N pages, no book around them
   --------------------------------------------------------------------------
   The page pack is the "one concept, no book" path: a real planner, the real
   page contract, the real validation gate, and a standalone HTML. These tests
   drive it with an injected model so nothing is invented and nothing is slow.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { group, ok, report, cli, ROOT } from './harness.mjs';
import { makePages, normalizeFormats } from '../src/engine/tools/make-pages.mjs';
import { planPages, validatePages, clampPages } from '../src/engine/tools/plan-from-source.mjs';
import { splitSheets } from '../src/engine/tools/lib/book-html.mjs';

const PAGE = `<section class="sheet bb">
  <h2 class="sr">A real sentence describing this page.</h2>
  <div class="tab"></div>
  <div class="top"><div class="eyebrow"><b>Pages</b> · No. NN</div><span class="pill">Concept</span></div>
  <h1 class="title">TITLE</h1>
  <div class="sub">a gloss on the title</div>
  <hr class="rule">
  <div class="diagram">
    <svg width="100%" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="two boxes joined">
      <rect x="4" y="20" width="80" height="50" rx="8" fill="#EEF2FF" stroke="#6366F1"/>
      <text x="44" y="49" text-anchor="middle" style="font-family:'Inter',sans-serif;font-size:12px;fill:#1A1A2E">one</text>
      <line x1="84" y1="45" x2="116" y2="45" stroke="#94A3B8" stroke-width="1.5"/>
      <rect x="116" y="20" width="80" height="50" rx="8" fill="#ECFDF5" stroke="#0D9488"/>
      <text x="156" y="49" text-anchor="middle" style="font-family:'Inter',sans-serif;font-size:12px;fill:#1A1A2E">two</text>
    </svg>
  </div>
  <hr class="rule">
  <div class="explain"><p>Short prose about the idea.</p><p class="close">It lands.</p></div>
  <div class="foot"><span class="brand">x</span><span class="pg"></span><span class="series">Pages</span></div>
</section>`;

/** A model that answers the page planner with N topics and every draft with a
 *  valid page. `badTitle` makes exactly that page fail validation. */
function model({ pages, badTitle = null }) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const sys = (body.messages || []).map((m) => m.content).join('\n');
    let text;
    if (/small-press page engine/.test(sys)) {
      text = JSON.stringify({
        title: 'A stub set',
        pages: Array.from({ length: pages }, (_, i) => ({
          title: `Page ${i + 1}`, topic: `topic ${i + 1}`, archetype: 'standard',
        })),
      });
    } else {
      const user = (body.messages || []).map((m) => m.content).join('\n');
      const isBad = badTitle && user.includes(`topic ${pages}`);
      text = isBad ? PAGE.replace(/<svg[\s\S]*?<\/svg>/, '').replace('TITLE', 'no drawing') : PAGE.replace('TITLE', `Page ${pages}`);
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) };
  };
}

group('a page count is clamped and formats are named once');
{
  ok('a count below one becomes one', clampPages(0) === 1);
  ok('a count above forty becomes forty', clampPages(99) === 40);
  ok('formats accept a comma list', normalizeFormats('html,md').join(',') === 'html,md');
  ok('"all" means every format', normalizeFormats('all').join(',') === 'html,png,pdf,md');
  ok('an unknown format is refused', (() => { try { normalizeFormats('docx'); return false; } catch { return true; } })());
  ok('html is always among the outputs', normalizeFormats('md').includes('html'));
}

group('the page planner validates the pages it is handed');
{
  const good = { title: 'x', pages: [
    { title: 'A', topic: 'a', archetype: 'standard' },
    { title: 'B', topic: 'b', archetype: 'procedure' },
  ] };
  ok('a well-formed page plan passes', validatePages(good).ok);
  ok('two pages with one title are refused',
    !validatePages({ pages: [{ title: 'A', topic: 'a', archetype: 'standard' }, { title: 'A', topic: 'b', archetype: 'standard' }] }).ok);
  ok('an unknown page shape is refused',
    !validatePages({ pages: [{ title: 'A', topic: 'a', archetype: 'bedtime' }] }).ok);
  const got = await planPages({ source: 'x', topic: 'x', pages: 2, provider: 'ollama', fetchImpl: model({ pages: 2 }) });
  ok('the planner returns exactly the requested number', got.plan.pages.length === 2);
  ok('a short plan is warned about, not padded',
    (await planPages({ source: 'x', pages: 3, provider: 'ollama', fetchImpl: model({ pages: 2 }) }))
      .validation.warnings.some((w) => /asked for 3/.test(w)));
}

group('a page pack is N pages with no book furniture, and all four formats');
{
  const dir = path.join(ROOT, 'pages', 'uitest-pages');
  fs.rmSync(dir, { recursive: true, force: true });
  const r = await makePages({
    slug: 'uitest-pages', source: 'a source about a thing', topic: 'a thing',
    pages: 2, provider: 'ollama', fetchImpl: model({ pages: 2 }),
    formats: 'all', outDir: dir,
  });

  ok('two pages were written', r.count === 2 && r.pages.filter((p) => p.ok).length === 2);
  ok('there is no generated (book) sheet', !/class="sheet gp/.test(fs.readFileSync(r.htmlPath, 'utf8')));
  /* Inlined theme CSS carries doc comments that quote a sheet, so strip style
     and script bodies before counting real sheets. */
  const raw = fs.readFileSync(r.htmlPath, 'utf8');
  const sheets = splitSheets(raw.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, ''));
  ok('the html holds exactly the page sheets', sheets.length === 2, `${sheets.length} sheets: ${sheets.map((s) => s.title).join(' | ')}`);
  ok('the standalone html inlines its stylesheet', /<style data-from=/.test(fs.readFileSync(r.htmlPath, 'utf8')));
  ok('a pdf was written', !!r.pdfPath && fs.readFileSync(r.pdfPath).slice(0, 5).toString().includes('%PDF'));
  ok('one png per page was written', r.pngs.length === 2, r.pngs.join(', '));
  ok('one markdown file per page was written', r.mds.length === 2, r.mds.join(', '));

  const checked = cli('check.mjs', r.htmlPath, '--json');
  let verdict = null;
  try { verdict = JSON.parse(checked.stdout.slice(checked.stdout.indexOf('{'))); } catch { /* reported below */ }
  ok('the pack measures, and every page is 0 mm',
    !!verdict && verdict.pages === 2 && verdict.overflowing.length === 0,
    verdict ? `${verdict.pages} pages, ${verdict.overflowing.length} over` : checked.stderr || checked.stdout);

  fs.rmSync(dir, { recursive: true, force: true });
}

group('a page that fails the contract is skipped and named, never patched in');
{
  const dir = path.join(ROOT, 'pages', 'uitest-pages-bad');
  fs.rmSync(dir, { recursive: true, force: true });
  const r = await makePages({
    slug: 'uitest-pages-bad', source: 'x', topic: 'x',
    pages: 2, provider: 'ollama', fetchImpl: model({ pages: 2, badTitle: 'Page 2' }),
    formats: 'html', outDir: dir,
  });
  ok('the valid page still ships', r.count === 1);
  ok('the invalid page is reported, not written', r.failures.length === 1 && /no <svg>|rule error/.test(r.failures[0].reason), r.failures[0]?.reason);
  fs.rmSync(dir, { recursive: true, force: true });
}

report('pages');
