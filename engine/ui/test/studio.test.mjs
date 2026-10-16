/* ==========================================================================
   test/studio.test.mjs  -  Phase 7: the diagram studio and the board
   --------------------------------------------------------------------------
   The cockpit gained two server endpoints it drives from the browser:

     /api/diagram          list shapes; compile a spec to SVG
     /api/diagram/example  a starter spec for a shape
     /api/facts            the fact ledger, attributed to pages
     /api/board            a map of the book read from its interior source

   These tests drive the real server over HTTP. The compile path is the SAME
   diagram.mjs a page is built with, so "the studio shows what the page gets"
   is checked by compiling twice and comparing bytes.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { withServer, withScratch, ok, group, report, ROOT, SCRATCH } from './harness.mjs';

group('diagram: shape list');
await withServer(async (base) => {
  const r = await fetch(`${base}/api/diagram`);
  const d = await r.json();
  ok('GET /api/diagram is 200', r.ok, String(r.status));
  ok('lists every known shape', Array.isArray(d.shapes) && d.shapes.length === 9, `${d.shapes?.length}`);
  ok('every shape has a kind and a use', (d.shapes || []).every((s) => s.kind && s.use));
  ok('lists the roles', (d.roles || []).includes('mechanism') && (d.roles || []).includes('bad'));
  ok('reports the view width', d.viewW === 592, String(d.viewW));
  ok('kinds include pipeline', (d.kinds || []).includes('pipeline'));
});

group('diagram: examples compile');
await withServer(async (base) => {
  const r = await fetch(`${base}/api/diagram/example?kind=funnel`);
  const d = await r.json();
  ok('GET example is 200', r.ok, String(r.status));
  ok('example kind round-trips', d.kind === 'funnel' && d.spec.kind === 'funnel');
  ok('example compiles to svg', /^<svg /.test(d.svg) && d.svg.includes('viewBox="0 0 592'), '');

  const bad = await fetch(`${base}/api/diagram/example?kind=nope`);
  const badj = await bad.json();
  ok('unknown kind is 404', bad.status === 404, String(bad.status));
  ok('unknown kind lists what exists', /Known:/.test(badj.error || ''), badj.error);
});

group('diagram: compile a spec');
await withServer(async (base) => {
  const spec = {
    kind: 'row',
    aria: 'a request passing through a limiter',
    cards: [{ title: 'You' }, { title: 'Limiter', role: 'mechanism' }, { title: 'API', role: 'good' }],
  };

  const r = await fetch(`${base}/api/diagram`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec }),
  });
  const d = await r.json();
  ok('POST compile is 200', r.ok, String(r.status));
  ok('svg carries the aria label', /aria-label="a request passing through a limiter"/.test(d.svg || ''), '');
  ok('svg has a role=img', /role="img"/.test(d.svg || ''), '');

  /* The studio must show the SAME bytes the page would get. */
  const r2 = await fetch(`${base}/api/diagram`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec),
  });
  const d2 = await r2.json();
  ok('compile is deterministic', d.svg === d2.svg, '');

  /* A bare spec (no { spec } wrapper) is accepted, because the studio's textarea
     holds exactly that. */
  const r3 = await fetch(`${base}/api/diagram`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec),
  });
  const d3 = await r3.json();
  ok('POST compiles a bare spec', r3.ok && /^<svg /.test(d3.svg || ''), String(r3.status));

  const broken = await fetch(`${base}/api/diagram`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec: { kind: 'wat' } }),
  });
  const bj = await broken.json();
  ok('unknown kind is 400', broken.status === 400, String(broken.status));
  ok('error names the known kinds', /Known:/.test(bj.error || ''), bj.error);

  const notjson = await fetch(`${base}/api/diagram`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ not json',
  });
  ok('bad JSON is 400', notjson.status === 400, String(notjson.status));
});

group('facts: the ledger');
await withServer(async (base) => {
  const clean = await fetch(`${base}/api/facts?book=starter`);
  const cj = await clean.json();
  ok('starter ledger is 200', clean.ok, String(clean.status));
  ok('starter has no open facts', cj.count === 0 && Array.isArray(cj.facts), `${cj.count}`);

  const missing = await fetch(`${base}/api/facts?book=no-such-book`);
  ok('missing book is 404', missing.status === 404, String(missing.status));
});

group('board: the map of a book');
await withServer(async (base) => {
  const r = await fetch(`${base}/api/board?book=starter`);
  const d = await r.json();
  ok('starter board is 200', r.ok, String(r.status));
  ok('board has pages', Array.isArray(d.pages) && d.pages.length >= 1, `${d.pages?.length}`);
  ok('board totals count pages', d.totals.pages === d.pages.length);
  const ssrf = d.pages.find((p) => p.title === 'SSRF');
  ok('the SSRF page is listed', !!ssrf && ssrf.listed === true, '');
  ok('a listed page knows its part', ssrf?.part === 'Your first part', ssrf?.part);

  const missing = await fetch(`${base}/api/board?book=nope`);
  ok('missing book is 404', missing.status === 404, String(missing.status));
});

group('board + facts: a page with a diagram and an open question');
await withScratch(async () => {
  /* Add a page to the scratch interior that has a fact and an inline SVG, and a
     second page that is NOT listed in book.json. The board must see both. */
  const interior = path.join(ROOT, 'books', SCRATCH, `${SCRATCH}.html`);
  const head = fs.readFileSync(interior, 'utf8');
  const middle = head.lastIndexOf('</main>');
  const extra = `
    <section class="sheet bb">
      <h1 class="title">The open page</h1>
      <figure class="diagram"><svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><text x="1" y="5" fill="#000">x</text></svg></figure>
      <p class="explain">This page still needs [FACT NEEDED: the current Bank Rate].</p>
    </section>
  `;
  fs.writeFileSync(interior, head.slice(0, middle) + extra + head.slice(middle));

  await withServer(async (base) => {
    const b = await (await fetch(`${base}/api/board?book=${SCRATCH}`)).json();
    const page = b.pages.find((p) => p.title === 'The open page');
    ok('board sees the new page', !!page, '');
    ok('board flags its diagram', page?.diagram === true, '');
    ok('board flags its fact', page?.facts === 1, String(page?.facts));
    ok('board flags it unlisted', page?.listed === false, '');
    ok('totals count the fact', b.totals.facts === 1, String(b.totals.facts));
    ok('totals count every diagram',
      b.totals.diagrams === b.pages.filter((p) => p.diagram).length, `${b.totals.diagrams}`);

    const f = await (await fetch(`${base}/api/facts?book=${SCRATCH}`)).json();
    ok('ledger finds the fact', f.count === 1, String(f.count));
    ok('ledger attributes it to the page', f.facts[0]?.title === 'The open page', f.facts[0]?.title);
    ok('ledger keeps the question', f.facts[0]?.text === 'the current Bank Rate', f.facts[0]?.text);
  });
});

report('studio');
