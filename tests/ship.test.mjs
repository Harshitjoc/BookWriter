/* ==========================================================================
   test/ship.test.mjs  -  Phase 8: publishing, exporting and print-craft
   --------------------------------------------------------------------------
   The cockpit now drives the rest of the engine from the browser:

     build  --gutter/--bleed/--start-recto  (the print-craft flags)
     epub / web / card                       the Phase 4 exporters
     publish                                 the Phase 5 hard gate
     /api/draft ledger                       every cockpit draft is recorded

   These tests prove the SERVER passes each one through to the real tool —
   the same script a person would run — and that a refusal arrives as a plain
   400 with a reason, not a stack trace.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { withServer, readSSE, withScratch, fakeModel, ok, group, report, ROOT, SCRATCH } from './harness.mjs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const books = (slug) => path.join(ROOT, 'books', slug);

/* /api/run takes tool args at the TOP level (the UI spreads them), and hands
   back an SSE where the exit code rides in the 'done' event. */
const exitOf = (r) => r.events.find((e) => e.event === 'done')?.data?.code;
const runOK = (r) => r.status === 200 && exitOf(r) === 0;

group('build: the print-craft flags reach the tool');
await withScratch(async () => {
  await withServer(async (base) => {
    /* --gutter 8 --bleed 3 --start-recto in ONE request. */
    const r = await readSSE(base, '/api/run', {
      tool: 'build', book: SCRATCH, gutter: 8, bleed: 3, startRecto: true,
    });
    ok('a crafted build succeeds', runOK(r), `exit ${exitOf(r)}`);

    let html = fs.readFileSync(path.join(books(SCRATCH), 'book.html'), 'utf8');
    ok('the gutter rule is in the built file',
      /--gutter 8mm/.test(html) && /nth-child\(odd\)\{ padding-left/.test(html), '');
    ok('the bleed page size is in the built file',
      /--bleed 3mm/.test(html) && /box-shadow:0 0 0 3mm var\(--paper\)/.test(html), '');
    ok('every part opened on a recto (blank versos inserted)',
      /class="sheet gp blank"/.test(html), '');

    /* A plain rebuild drops the craft: the toggles are off-by-default. */
    const p = await readSSE(base, '/api/run', { tool: 'build', book: SCRATCH });
    ok('a plain rebuild succeeds', runOK(p), `exit ${exitOf(p)}`);
    html = fs.readFileSync(path.join(books(SCRATCH), 'book.html'), 'utf8');
    ok('turning the craft off restores a plain build',
      !/--gutter|--bleed|sheet gp blank/.test(html), '');

    /* Garbage must die as a 400 with a reason. */
    const badGutter = await readSSE(base, '/api/run', { tool: 'build', book: SCRATCH, gutter: 'abc' });
    ok('a non-numeric gutter is refused', badGutter.status === 400 && /1 to 60/.test(badGutter.error || ''), badGutter.error);
    const badBleed = await readSSE(base, '/api/run', { tool: 'build', book: SCRATCH, bleed: 99 });
    ok('an absurd bleed is refused', badBleed.status === 400 && /1 to 12/.test(badBleed.error || ''), badBleed.error);
  });
});

group('export: epub, web, card from the cockpit');
await withScratch(async () => {
  await withServer(async (base) => {
    await readSSE(base, '/api/run', { tool: 'build', book: SCRATCH });

    const e = await readSSE(base, '/api/run', { tool: 'epub', book: SCRATCH });
    ok('epub export runs', runOK(e), `exit ${exitOf(e)}`);
    ok('book.epub exists in the book folder', fs.existsSync(path.join(books(SCRATCH), 'book.epub')));

    const w = await readSSE(base, '/api/run', { tool: 'web', book: SCRATCH });
    ok('web export runs', runOK(w), `exit ${exitOf(w)}`);
    const web = fs.readFileSync(path.join(books(SCRATCH), 'book-web.html'), 'utf8');
    ok('book-web.html is a single offline file', web.includes('reader-bar'));

    const c = await readSSE(base, '/api/run', { tool: 'card', book: SCRATCH, page: 1, format: 'html' });
    ok('card export runs', runOK(c), `exit ${exitOf(c)}`);
    ok('card-1.html exists', fs.existsSync(path.join(books(SCRATCH), 'card-1.html')));

    const cBad = await readSSE(base, '/api/run', { tool: 'card', book: SCRATCH, page: 0, format: 'html' });
    ok('a card for page 0 is refused', cBad.status === 400, cBad.error);
    const cFmt = await readSSE(base, '/api/run', { tool: 'card', book: SCRATCH, page: 1, format: 'docx' });
    ok('an unknown card format is refused', cFmt.status === 400 && /html, png or md/.test(cFmt.error || ''), cFmt.error);
  });
});

group('publish: the hard gate runs from the cockpit');
await withScratch(async () => {
  await withServer(async (base) => {
    /* starter has no open facts, so the whole gate should run and ship all
       three formats. */
    const r = await readSSE(base, '/api/run', { tool: 'publish', book: SCRATCH, formats: 'pdf,epub,web' });
    ok('publish runs to exit 0', runOK(r), `exit ${exitOf(r)}`);
    for (const f of ['book.pdf', 'book.epub', 'book-web.html']) {
      const p = path.join(books(SCRATCH), f);
      ok(`${f} was published`, fs.existsSync(p) && fs.statSync(p).size > 0, '');
    }

    const ignored = await readSSE(base, '/api/run', { tool: 'publish', book: SCRATCH, formats: 'pdf,docx' });
    ok('a banned format is refused before the gate runs', ignored.status === 400 && /Known: pdf, epub, web/.test(ignored.error || ''), ignored.error);
    const banned = await readSSE(base, '/api/run', { tool: 'publish', book: SCRATCH, formats: ['docx'] });
    ok('a banned format in a list is refused too', banned.status === 400, banned.error);
  });
});

group('board: the dashboard fields');
await withScratch(async () => {
  await withServer(async (base) => {
    const d = await (await fetch(`${base}/api/board?book=${SCRATCH}`)).json();
    ok('board reports the default theme', d.theme === 'studio', d.theme);
    ok('board reports the default size', d.size === 'b5', d.size);
    ok('board lists the editions', Array.isArray(d.editions) && d.editions.includes('free'), d.editions.join(','));
    ok('parts carry their page counts', d.parts.every((p) => typeof p.pages === 'number'), '');
    ok('artifacts is a tri-state map', typeof d.artifacts?.pdf === 'boolean'
      && typeof d.artifacts?.epub === 'boolean' && typeof d.artifacts?.web === 'boolean', '');
  });
});

group('draft: every cockpit draft is recorded and replayable');
await withScratch(async () => {
  const PAGE = '<section class="sheet bb"><h1 class="title">Reproducible</h1><p class="explain">A page.</p></section>';
  const fake = await fakeModel({ content: PAGE });
  try {
    await withServer(async (base) => {
      const payload = { book: SCRATCH, topic: 'reproducible', provider: 'ollama', seed: 7 };
      const one = await readSSE(base, '/api/draft', payload);
      const meta1 = one.events.find((e) => e.event === 'done')?.data?.meta;
      const section1 = one.events.find((e) => e.event === 'done')?.data?.section;
      ok('the first draft completes and carries a page', section1?.includes('Reproducible'), '');
      ok('the run was recorded in the ledger', meta1?.ledger === true, '');
      ok('the run kept the seed', meta1?.seed === 7, String(meta1?.seed));
      ok('a request key was stored', typeof meta1?.requestKey === 'string' && meta1.requestKey.length > 8, meta1?.requestKey);

      const ledgerDir = path.join(books(SCRATCH), '.gen', 'cache');
      const cached = fs.existsSync(ledgerDir) && fs.readdirSync(ledgerDir).length === 1;
      ok('the .gen cache holds the request', cached, '');

      const two = await readSSE(base, '/api/draft', payload);
      const meta2 = two.events.find((e) => e.event === 'done')?.data?.meta;
      const section2 = two.events.find((e) => e.event === 'done')?.data?.section;
      ok('a byte-identical re-draft replays from the cache', meta2?.replayed === true, '');
      ok('the replayed page is the same text', section2?.includes('Reproducible') && section2 === section1, '');
    }, { OLLAMA_BASE_URL: fake.baseUrl, OLLAMA_MODEL: 'x' });
  } finally {
    await fake.close();
  }
});

report('ship');