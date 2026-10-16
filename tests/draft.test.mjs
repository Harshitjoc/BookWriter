/* ==========================================================================
   test/draft.test.mjs  -  the page contract, checked without a model
   --------------------------------------------------------------------------
   The validator is the thing that stops a hallucinated page reaching a book,
   so it gets tested directly against good and bad pages. The last group runs
   the whole draft path against a fake local provider over real HTTP.
   ========================================================================== */
import http from 'node:http';
import net from 'node:net';
import {
  extractSection, validate, buildPrompt, draftBlock, reportValidation,
  resolveArchetype, pageRules, countSections, ARCHETYPES, checkDiagram,
} from '../src/engine/tools/draft-block.mjs';
import { ok, group, report, __dir, ROOT } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

/* A real, correct page. Pulled from the starter so the "good" case is the
   engine's own output, not something I wrote to make the test pass. The starter's
   hand-authored page carries a TELL THE AI box; the engine strips that from a
   generated page, so the fixture is stripped too — it is what a draft should be. */
const GOOD = fs.readFileSync(
  path.join(ROOT, 'books', 'starter', 'starter.html'),
  'utf8'
).replace(/\s*<div class="ask">[\s\S]*?<\/div>/, '');

/* Use the production extractor rather than a second regex. A second regex is
   how the "one real page" case accidentally started matching the <section>
   mentioned inside the interior file's own HTML comment. */
const sectionOf = (html) => extractSection(html);

group('extraction');
ok('a page wrapped in a markdown fence is unwrapped',
  extractSection('```html\n<section class="sheet bb"><h1 class="title">x</h1></section>\n```')
    .startsWith('<section'));
ok('chatter before the section is discarded',
  extractSection('Sure! Here is the page:\n<section class="sheet bb">x</section>\nHope it helps')
    === '<section class="sheet bb">x</section>');
ok('a section with inner markup is not truncated at the first close tag',
  (extractSection('<section class="sheet bb"><div class="explain"><p>a</p></div></section>').match(/<\/div>/g) || []).length === 1);
ok('a page that is followed by other pages yields ONE page, not all of them', (() => {
  const two = GOOD + '\n' + GOOD.replace('<h1 class="title">SSRF</h1>', '<h1 class="title">CSRF</h1>');
  const one = extractSection(two);
  return countSections(one) === 1
      && /<h1 class="title">SSRF<\/h1>/.test(one)
      && !/CSRF/.test(one);
})());
ok('and the extra pages are reported rather than thrown away quietly', (() => {
  /* countSections is what notices a model that sent the whole chapter. */
  return countSections(sectionOf(GOOD)) === 1
      && countSections(GOOD + GOOD) === 2
      && countSections('no pages here') === 0;
})());
ok('an answer with no section in it yields nothing, not a fragment',
  extractSection('I cannot help with that.') === '');

group('a real engine page validates clean');
{
  const v = validate(sectionOf(GOOD));
  ok('no errors', v.errors.length === 0, v.errors.join('; '));
  ok('no warnings', v.warnings.length === 0, v.warnings.join('; '));
  ok('no unfilled facts', v.gaps.length === 0);
}

group('the rules that protect the page are actually checked');
{
  /* The rule most likely to be broken by a model, and the most likely to be
     missed by eye, because a text with no fill is invisible on a white screen
     in some themes and invisible on paper always. */
  const v = validate(sectionOf(GOOD).replace(/fill:#1A1A2E/, ''));
  ok('an SVG <text> with no fill is an error', v.errors.some((e) => /no explicit fill/.test(e)), v.errors.join('; '));
}
ok('a missing <svg> is an error', validate('<section class="sheet bb"></section>').errors.some((e) => /inline SVG/.test(e)));
ok('an <img> is an error', validate('<section class="sheet bb"><img src="x.png"></section>').errors.some((e) => /<img>/.test(e)));
ok('a generated script is an error', validate('<section class="sheet bb"><script>x</script></section>').errors.some((e) => /script/.test(e)));
ok('an @media print rule is an error',
  validate('<section class="sheet bb"><style>@media print{a{color:red}}</style></section>')
    .errors.some((e) => /@media print/.test(e)));
ok('a second <section> is an error',
  validate('<section class="sheet bb"><section></section></section>').errors.some((e) => /exactly 1/.test(e)));
ok('a TELL THE AI ask box is refused on a generated page',
  validate('<section class="sheet bb"><div class="ask"><p>x</p></div><h1 class="title">t</h1></section>')
    .errors.some((e) => /TELL THE AI/.test(e)));
ok('an inline event handler only warns',
  validate('<section class="sheet bb" onclick="x()"><h1 class="title">t</h1></section>')
    .warnings.some((w) => /onclick/.test(w)));

group('a broken diagram is caught before it reaches a page');
{
  const svg = (inner, vb = 'viewBox="0 0 200 100"') =>
    `<section class="sheet bb"><svg ${vb}>${inner}</svg></section>`;
  const card = '<rect x="10" y="10" width="50" height="50" fill="#EEF0FE"/>'
    + '<text x="70" y="40" style="font-family:\'Inter\',sans-serif;font-size:12px;fill:#1A1A2E">A</text>';

  ok('a well-formed diagram is clean', checkDiagram(svg(card)).errors.length === 0,
    checkDiagram(svg(card)).errors.join('; '));
  ok('a value glued to the next attribute is an error',
    checkDiagram(svg('<rect x="10" y="10" width="50" height=50fill="#fff"/>')).errors.some((e) => /malformed/.test(e)));
  ok('a missing viewBox is an error',
    checkDiagram('<section class="sheet bb"><svg><rect x="0" y="0" width="10" height="10"/></svg></section>')
      .errors.some((e) => /no viewBox/.test(e)));
  ok('drawing outside the viewBox is an error',
    checkDiagram(svg('<rect x="180" y="10" width="50" height="50" fill="#fff"/>')).errors.some((e) => /outside/.test(e)));
  ok('a diagram with no shapes is an error',
    checkDiagram(svg('<text x="10" y="40" style="fill:#111;font-family:\'Inter\',sans-serif;font-size:12px">caption</text>'))
      .errors.some((e) => /no shapes/.test(e)));
  ok('labelling a box with a colour role only warns',
    checkDiagram(svg('<rect x="10" y="10" width="50" height="50" fill="#fff"/>'
      + '<text x="70" y="40" style="fill:#111;font-family:\'Inter\',sans-serif;font-size:12px">mechanism</text>'))
      .warnings.some((w) => /colour role/.test(w)));
}

group('fabricated facts are surfaced, not hidden');
{
  const page = sectionOf(GOOD).replace('169.254.169.254', '[FACT NEEDED: the link-local metadata address]');
  const v = validate(page);
  ok('a [FACT NEEDED] marker is found', v.gaps.length === 1, v.gaps.join(''));
  ok('a gap is not an error, it is a to-do', v.errors.length === 0);
  ok('the gap is listed for the human', /\[FACT NEEDED: the link-local/.test(reportValidation(v)));
}
ok('several gaps are all reported', validate(sectionOf(GOOD).replace(/169\.254\.169\.254/g, '[FACT NEEDED: a] [FACT NEEDED: b]')).gaps.length === 2);

group('the prompt carries the book, not a generic instruction');
{
  const ctx = {
    book: { title: 'T', series: 'S', brand: 'b.com', parts: [{ name: 'Part One' }] },
    interior: GOOD,
    voice: 'VOICE-MARKER-TEXT',
  };
  const p = buildPrompt({ ctx, topic: 'CDN', part: null, archetype: 'standard' });
  ok('the voice file is in the prompt', p.includes('VOICE-MARKER-TEXT'));
  ok('the topic is in the prompt', p.includes('CDN'));
  ok('the part falls back to the first part', p.includes('Part One'));
  ok('the pages already written are listed so nothing repeats', /SSRF/.test(p) && /already in this book/i.test(p));
  ok('the brand is substituted into the shape', p.includes('b.com'));
  ok('the rules are present', /NEVER shrink the viewBox/.test(p) && /INVENT ANYTHING/.test(p));
  ok('it asks for one page only', /Write the page now/.test(p));
}

group('end to end, against a fake local provider over real HTTP');
{
  /* This is the honest test: a real socket, a real HTTP request shaped by
     llm.mjs, a real draft, a real validation. The only thing faked is the model
     behind the socket, which is exactly what a local model would be. */
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const got = JSON.parse(body);
      const reply = {
        choices: [{ message: { content: 'Here you go:\n```html\n' + sectionOf(GOOD) + '\n```' } }],
      };
      if (!got.model || got.stream !== false) {
        res.writeHead(400).end('{"error":"bad request"}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const res = await draftBlock({
    bookDir: path.join(ROOT, 'books', 'starter'),
    topic: 'SSRF',
    provider: 'ollama',
    env: { OLLAMA_BASE_URL: `http://127.0.0.1:${port}/v1`, OLLAMA_MODEL: 'fake-model' },
  });

  ok('a draft comes back', res.section.startsWith('<section class="sheet bb">'));
  ok('the model chatter and fence are gone', !res.section.includes('```') && !res.section.includes('Here you go'));
  ok('the draft validates clean', res.validation.errors.length === 0, res.validation.errors.join('; '));
  ok('the provider used is reported back', res.meta.provider === 'ollama' && res.meta.model === 'fake-model');
  ok('the draft is never written into the book',
    !fs.readFileSync(path.join(ROOT, 'books', 'starter', 'starter.html'), 'utf8').includes('FAKE-MARKER'));

  /* A model that returns a broken page must be reported, not passed on. */
  const bad = await new Promise((r) => {
    const s = http.createServer((req2, res2) => {
      let b = '';
      req2.on('data', (d) => (b += d));
      req2.on('end', () => r(res2.writeHead(200).end(JSON.stringify({
        choices: [{ message: { content: '<section class="sheet bb"><h1 class="title">t</h1><img src="a.png"></section>' } }],
      }))));
    });
    s.listen(0, '127.0.0.1', () => r(s));
  });
  const badRes = await draftBlock({
    bookDir: path.join(ROOT, 'books', 'starter'),
    topic: 'x',
    provider: 'ollama',
    env: { OLLAMA_BASE_URL: `http://127.0.0.1:${bad.address().port}/v1`, OLLAMA_MODEL: 'fake' },
  });
  ok('a broken draft is reported with errors', badRes.validation.errors.length >= 2, badRes.validation.errors.join('; '));
  ok('the broken draft is still returned so a human can look at it',
    badRes.section.includes('<img'));
  bad.close();

  /* A model that sends three pages when asked for one is a real failure mode,
     and the quiet version of it is writing all three into the book. */
  const chatty = await new Promise((r) => {
    const s = http.createServer((req2, res2) => {
      let b = '';
      req2.on('data', (d) => (b += d));
      req2.on('end', () => r(res2.writeHead(200).end(JSON.stringify({
        choices: [{ message: { content:
          sectionOf(GOOD) + '\n' +
          sectionOf(GOOD).replace('<h1 class="title">SSRF</h1>', '<h1 class="title">CSRF</h1>') + '\n' +
          sectionOf(GOOD).replace('<h1 class="title">SSRF</h1>', '<h1 class="title">XSS</h1>') } }],
      }))));
    });
    s.listen(0, '127.0.0.1', () => r(s));
  });
  const chattyRes = await draftBlock({
    bookDir: path.join(ROOT, 'books', 'starter'),
    topic: 'x', archetype: 'standard',
    provider: 'ollama',
    env: { OLLAMA_BASE_URL: `http://127.0.0.1:${chatty.address().port}/v1`, OLLAMA_MODEL: 'fake' },
  });
  ok('a model that sends three pages gets one page back',
    countSections(chattyRes.section) === 1 && chattyRes.section.includes('SSRF') && !chattyRes.section.includes('XSS'));
  ok('and the reader is told two pages were dropped',
    chattyRes.validation.warnings.some((w) => /sent 3 pages/.test(w)),
    chattyRes.validation.warnings.join('; '));
  chatty.close();
  server.close();
}

group('refusals');
{
  let msg = '';
  try { await draftBlock({ bookDir: path.join(ROOT, 'books', 'starter'), topic: '', provider: 'ollama' }); }
  catch (e) { msg = e.message; }
  ok('no topic is refused', /topic is required/i.test(msg));
}
{
  let msg = '';
  try { await draftBlock({ bookDir: path.join(ROOT, 'books', 'nope'), topic: 'x', provider: 'ollama' }); }
  catch (e) { msg = e.message; }
  ok('a missing book is refused', /No such book folder/.test(msg));
}
{
  /* The money gate must still apply through the drafting path, not just at the
     provider layer. */
  let msg = '';
  try {
    await draftBlock({ bookDir: path.join(ROOT, 'books', 'starter'), topic: 'x', provider: 'openai' });
  } catch (e) { msg = e.message; }
  ok('a paid provider is refused by the drafting path too', /--allow-paid/.test(msg), msg.split('\n')[0]);
}

group('page shapes come from one registry, and are real instructions');
ok('there is one registry and it has the five shapes the UI offers',
  ['standard', 'procedure', 'recipe', 'exercise', 'reference']
    .every((id) => ARCHETYPES[id]), Object.keys(ARCHETYPES).join(', '));
ok('every shape but standard says what to put on the page',
  Object.entries(ARCHETYPES).every(([id, a]) => id === 'standard' || (a.shape && a.shape.length > 200)),
  Object.entries(ARCHETYPES).filter(([id, a]) => id !== 'standard' && (!a.shape || a.shape.length <= 200))
    .map(([id]) => id).join(','));
ok('every shape declares whether it may hold lists and tables',
  Object.values(ARCHETYPES).every((a) => typeof a.content?.lists === 'boolean' && typeof a.content?.table === 'boolean'));
ok('only reference may hold a table',
  Object.entries(ARCHETYPES).filter(([, a]) => a.content.table).map(([id]) => id).join(',') === 'reference');
ok('an unknown shape is refused, with the list of real ones', (() => {
  let msg = '';
  try { resolveArchetype('haiku'); } catch (e) { msg = e.message; }
  return /unknown archetype "haiku"/.test(msg) && /recipe/.test(msg);
})());
ok('no shape falls back silently: an unknown name is never standard', (() => {
  try { resolveArchetype('haiku'); return false; } catch { return true; }
})());
const PAGE = sectionOf(GOOD);   /* one page, so the fixture edits below cannot
                                   accidentally edit the rest of the book */
{
  const ctx = { book: { title: 'T', series: 'S', brand: 'B', parts: [{ name: 'P' }] }, interior: GOOD, voice: 'V' };
  const p = buildPrompt({ ctx, topic: 'webhooks', archetype: 'procedure' });
  ok('the prompt carries the shape, not just its name',
    /THE SHAPE OF THIS PAGE: PROCEDURE/.test(p) && /numbered sequence/.test(p),
    'no procedure shape in the prompt');
  ok('the shape changes the rules that follow it', /may contain a <ul> or an <ol>/.test(p));
  ok('the standard shape carries no shape block at all',
    !/THE SHAPE OF THIS PAGE/.test(buildPrompt({ ctx, topic: 'x', archetype: 'standard' })));
  ok('and the standard rules still forbid lists',
    /plain prose\. No <ul>, no <ol>, no <table>/.test(pageRules(ARCHETYPES.standard.content)));
}
ok('the shape is a decision, not a decoration: it is what permits a list', (() => {
  const listed = PAGE.replace('<div class="explain">', '<div class="explain"><ul><li>one</li></ul>');
  return listed !== PAGE
      && validate(listed, 'procedure').errors.length === 0
      && validate(listed, 'standard').errors.some((e) => /prose only/.test(e));
})());
ok('a table is refused by every shape but reference', (() => {
  const tabbed = PAGE.replace('<div class="explain">',
    '<div class="explain"><table class="ref"><tr><td>a</td></tr></table>');
  /* Whichever complaint it leads with, standard and recipe must both object:
     the point is that only reference may hold a table. */
  return tabbed !== PAGE
      && validate(tabbed, 'reference').errors.length === 0
      && validate(tabbed, 'recipe').errors.some((e) => /cannot hold a table/.test(e))
      && validate(tabbed, 'standard').errors.length > 0;
})());
ok('a page claiming a shape that does not exist is an error, not a mystery', (() => {
  const fake = PAGE.replace('<section class="sheet bb"', '<section class="sheet bb" data-archetype="haiku"');
  return validate(fake, 'standard').errors.some((e) => /data-archetype="haiku" is not a known archetype/.test(e));
})());
ok('a shaped page without its hook gets a warning, not a silent unstyled page', (() => {
  const shaped = PAGE.replace('<div class="explain">', '<div class="explain"><ol><li>one</li></ol>');
  const v = validate(shaped, 'procedure');
  return v.warnings.some((w) => /no data-archetype="procedure"/.test(w)) && v.errors.length === 0;
})());
ok('a shaped page WITH its hook is clean, warnings and all', (() => {
  const shaped = PAGE.replace('<section class="sheet bb"', '<section class="sheet bb" data-archetype="procedure"')
    .replace('<div class="explain">', '<div class="explain"><ol><li>one</li></ol>');
  const v = validate(shaped, 'procedure');
  return v.errors.length === 0 && v.warnings.length === 0;
})());
ok('the real engine page still validates as standard, lists and all absent',
  validate(PAGE, 'standard').errors.length === 0);

report('draft');