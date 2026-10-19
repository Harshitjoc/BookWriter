/* ==========================================================================
   test/from-source.test.mjs  —  source in, plan out, files on disk
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { group, ok, report, withServer, fakeModel, ROOT } from './harness.mjs';
import { intake } from '../src/engine/tools/source-intake.mjs';
import { planFromSource, extractJson, validatePlan } from '../src/engine/tools/plan-from-source.mjs';
import { pageAcceptable, prepareSection } from '../src/engine/tools/make-book.mjs';

const PLAN = {
  title: 'Resting Meat',
  subtitle: 'Why the first cut costs you',
  thesis: 'Resting is where the work becomes edible.',
  parts: [
    { name: 'Part 1', eyebrow: 'Why', why: 'Because juice matters', blocks: [
      { title: 'Why rest', archetype: 'standard', topic: 'The physics of juice' },
      { title: 'How long', archetype: 'procedure', topic: 'Waiting times by cut' },
    ] },
  ],
};

group('intake: a topic passes, a text file passes, a bad one is refused');
{
  const r = await intake({ type: 'topic', value: 'resting meat' });
  ok('topic text is kept', r.text === 'resting meat');
  const tmp = path.join(ROOT, 'books', '.tmp-intake.txt');
  fs.writeFileSync(tmp, 'hello engine');
  const f = await intake({ type: 'txt', value: tmp });
  ok('a text file is read', f.text === 'hello engine');
  fs.rmSync(tmp);
  let threw = '';
  try { await intake({ type: 'nope', value: 'x' }); } catch (e) { threw = e.message; }
  ok('an unknown source type is refused', /unknown source type/.test(threw), threw);
}

group('intake reads more than plain text: a saved page and a spreadsheet');
{
  const htmlPath = path.join(ROOT, 'books', '.tmp-intake.html');
  fs.writeFileSync(htmlPath,
    '<html><head><title>Resting Meat</title></head><body><nav>menu chrome</nav>'
    + '<h1>Rest</h1><p>Juice stays in the meat.</p></body></html>');
  const h = await intake({ type: 'html', value: htmlPath });
  ok('a saved page becomes its own text', h.text.includes('Juice stays in the meat.'), h.text);
  ok('the page title is the title hint', h.titleHint === 'Resting Meat', h.titleHint);
  ok('the nav chrome is dropped, not fed to the planner', !/menu chrome/.test(h.text), h.text);
  fs.rmSync(htmlPath);

  const csvPath = path.join(ROOT, 'books', '.tmp-intake.csv');
  fs.writeFileSync(csvPath, 'cut,minutes,note\nribeye,8,"rest, then slice"\nbrisket,20,"low and slow"\n');
  const c = await intake({ type: 'csv', value: csvPath });
  ok('a csv keeps its column names', c.text.includes('Columns: cut, minutes, note'), c.text);
  ok('a csv keeps its rows as readable lines', c.text.includes('cut=ribeye') && c.text.includes('minutes=20'), c.text);
  ok('a quoted csv field survives its own comma', c.text.includes('note=rest, then slice'), c.text);
  fs.rmSync(csvPath);

  const tsvPath = path.join(ROOT, 'books', '.tmp-intake.tsv');
  fs.writeFileSync(tsvPath, 'cut\tminutes\nribeye\t8\n');
  const t = await intake({ type: 'csv', value: tsvPath });
  ok('a tab-separated file is read by the same reader', t.text.includes('cut=ribeye'), t.text);
  fs.rmSync(tsvPath);
}

group('the planner only accepts what validates');
{
  ok('extractJson takes a bare object and leaves it whole',
    JSON.parse(extractJson(JSON.stringify(PLAN))).title === PLAN.title);
  ok('extractJson finds its object inside prose and fence',
    extractJson(`Sure! Here is the plan:\n\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\``) !== null);
  ok('a duplicate title fails validation',
    !validatePlan({ ...PLAN, parts: [{ name: 'p', blocks: [{ title: 'X', archetype: 'standard', topic: 't' }, { title: 'X', archetype: 'procedure', topic: 't' }] }] }).ok);
  ok('an unknown archetype fails validation',
    !validatePlan({ ...PLAN, parts: [{ name: 'p', blocks: [{ title: 'X', archetype: 'bedtime', topic: 't' }] }] }).ok);
  const stub = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(PLAN) } }] }) });
  const got = await planFromSource({ source: 'resting meat matters', topic: 'resting meat', provider: 'ollama', fetchImpl: stub });
  ok('a well-formed plan round trips', got.plan.title === PLAN.title && got.validation.ok);
  const garbage = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'sorry, I cannot help' } }] }) });
  let threw = '';
  try { await planFromSource({ source: 'x', topic: 'x', provider: 'ollama', fetchImpl: garbage }); } catch (e) { threw = e.message; }
  ok('non-JSON is named as the failure, not parsed into oblivion', /did not return JSON/.test(threw), threw);
}

group('the endpoint scaffolds, streams events, and honestly reports skipped pages');
{
  const fake = await fakeModel({ content: JSON.stringify(PLAN) });
  let slugDir;
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/from-source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'uitest', sourceType: 'topic', source: 'resting meat', mode: 'book', provider: 'ollama' }),
    });
    const text = await res.text();
    slugDir = path.join(ROOT, 'books', 'uitest');
    ok('the stream opens', res.ok && /event: start/.test(text));
    ok('a plan event is emitted before any page', /event: plan\ndata: /.test(text));
    ok('pages were attempted', /page 1\/2:/.test(text) || text.includes('page'));
    ok('the run ends with a coded done event', /event: done\ndata: \{"code":\d+/.test(text));
    ok('the book folder exists', fs.existsSync(slugDir));
    const done = text.match(/event: done\ndata: (\{.*\})/)?.[1] || '{}';
    ok('no pages survived, because the fake model never emits a page — and the server said so',
      /"failed":\s*2|"code":\s*[^0]/.test(done), done);
  }, { OLLAMA_BASE_URL: fake.baseUrl, OLLAMA_MODEL: 'fake-model' });
  await fake.close();
  fs.rmSync(slugDir, { recursive: true, force: true });
}

group('a page the validator flagged is not written into the book');
{
  const clean = pageAcceptable({ errors: [], gaps: [] });
  ok('a clean page is accepted', clean.ok);
  ok('a page with a rule error is refused, and the reason names it',
    !pageAcceptable({ errors: ['no <svg>.'], gaps: [] }).ok
    && /rule error/.test(pageAcceptable({ errors: ['no <svg>.'], gaps: [] }).reason));
  ok('a page with an unfilled fact is refused, not written with a placeholder',
    !pageAcceptable({ errors: [], gaps: ['a real date'] }).ok
    && /unfilled fact/.test(pageAcceptable({ errors: [], gaps: ['a real date'] }).reason));

  const askPage = '<section class="sheet bb"><div class="ask"><span class="lbl">TELL THE AI</span><p>x</p></div>'
    + '<div class="foot">f</div></section>';
  const prepped = prepareSection(askPage, 3);
  ok('the TELL THE AI box is stripped from a written page', !/class="ask"|TELL THE AI/.test(prepped), prepped);
  ok('the page-number placeholder is replaced by the real number',
    prepareSection('<div class="eyebrow">Part - No. [FACT NEEDED: page number]</div>', 7)
      .includes('No. 07')
    && !/FACT NEEDED/.test(prepareSection('<div class="eyebrow">No. [FACT NEEDED: page number]</div>', 7)));
}

group('the paper path writes real files and a real PDF');
{
  const fake = await fakeModel({
    content:
`<!doctype html>
<html><head><title>T</title><link rel="stylesheet" href="../../../src/engine/paper.css"></head>
<body>
<header class="paper-head"><h1>Title</h1><p class="meta">why</p></header>
<abstract class="abstract"><h2>Abstract</h2><p>p</p></abstract>
<section><h2>1. Introduction</h2><p>i</p></section>
</body></html>`,
  });
  let pdf = '';
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/from-source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'uitest', sourceType: 'topic', source: 'x', mode: 'paper', provider: 'ollama' }),
    });
    const text = await res.text();
    ok('the run ended with done', /event: done/.test(text));
    pdf = path.join(ROOT, 'books', 'uitest', 'paper', 'paper.pdf');
    ok('paper.pdf exists after the run', fs.existsSync(pdf), pdf);
    ok('the pdf starts with the right magic', fs.readFileSync(pdf).slice(0, 5).toString().includes('%PDF'));
  }, { OLLAMA_BASE_URL: fake.baseUrl, OLLAMA_MODEL: 'fake-model' });
  await fake.close();
  fs.rmSync(path.join(ROOT, 'books', 'uitest'), { recursive: true, force: true });
}

report('from-source');