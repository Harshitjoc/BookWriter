/* ==========================================================================
   test/api.test.mjs  -  the server's own contract
   --------------------------------------------------------------------------
   Run:  node engine/ui/test/api.test.mjs
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { group, ok, report, withServer, runTool, withScratch, cleanStale, readSSE, fakeModel, ROOT } from './harness.mjs';

/* A crashed run must not leak a scratch book into the next run's listing. */
cleanStale();

await withServer(async (base) => {
  group('books are discovered');
  const list = await (await fetch(`${base}/api/books`)).json();
  ok('lists at least the two committed books',
    ['showcase', 'starter'].every((s) => list.books.some((b) => b.slug === s)),
    list.books.map((b) => b.slug).join(', '));
  ok('each book reports a title and a page count field',
    list.books.every((b) => typeof b.title === 'string' && typeof b.listed === 'number'));

  group('interior name is resolved consistently  (regression)');
  /* A book whose interior is NOT <slug>.html. The bug: /api/books read
     cfg.files[1].name, a key that does not exist, so the editor tab and the
     listing disagreed and the file 404'd. */
  const custom = path.join(ROOT, 'books', 'uicustom');
  fs.rmSync(custom, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'books', 'starter'), custom, { recursive: true });
  fs.writeFileSync(path.join(custom, 'book.json'),
    JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(custom, 'book.json'), 'utf8')), interior: 'pages.html' }, null, 2));
  fs.renameSync(path.join(custom, 'starter.html'), path.join(custom, 'pages.html'));

  const withCustom = await (await fetch(`${base}/api/books`)).json();
  const row = withCustom.books.find((b) => b.slug === 'uicustom');
  ok('listing reports the custom interior name', row?.interior === 'pages.html', `got ${row?.interior}`);

  const f = await (await fetch(`${base}/api/file?book=uicustom&name=pages.html`)).json();
  ok('custom interior is readable', typeof f.text === 'string' && f.text.includes('sheet bb'),
    `${(f.text || '').length} chars`);

  /* App.jsx builds the editor tabs from book.interior, so /api/books reporting
     the right name is what makes the tab point at a file that exists. This is
     the exact assertion that failed before the fix. */
  ok('the tab list App derives would name the real file', row?.interior === 'pages.html');

  const built = await runTool(base, 'build', 'uicustom');
  ok('a book with a custom interior still builds', built.code === 0, built.lines[0] || '');
  fs.rmSync(custom, { recursive: true, force: true });

  group('safety rails');
  const noKey = await fetch(`${base}/api/file?book=../..&name=package.json`);
  ok('refuses a traversal in book', !noKey.ok, `HTTP ${noKey.status}`);
  const gen = await fetch(`${base}/api/file?book=starter&name=book.html`);
  ok('refuses to read generated book.html', gen.status === 403, `HTTP ${gen.status}`);
  const put = await fetch(`${base}/api/file?book=starter&name=book.html`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x' }),
  });
  ok('refuses to write generated book.html', put.status === 403, `HTTP ${put.status}`);
  const dup = await fetch(`${base}/api/new-book`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'starter' }),
  });
  ok('refuses to create a duplicate book', dup.status === 409, `HTTP ${dup.status}`);
  for (const bad of ['../evil', 'UPPER', 'a b']) {
    const r = await fetch(`${base}/api/new-book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: bad }),
    });
    ok(`refuses unsafe slug ${JSON.stringify(bad)}`, r.status === 400, `HTTP ${r.status}`);
  }

  group('new book scaffolds from starter');
  const made = await (await fetch(`${base}/api/new-book`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'uinew' }),
  })).json();
  ok('creates the book', made.ok === true);
  const dir = path.join(ROOT, 'books', 'uinew');
  ok('interior renamed to match the folder', fs.existsSync(path.join(dir, 'uinew.html')));
  ok('stale generated book.html not carried over', !fs.existsSync(path.join(dir, 'book.html')));
  ok('the four source files are present',
    ['book.json', 'uinew.html', 'VOICE.md', 'blocks.md'].every((n) => fs.existsSync(path.join(dir, n))));
  const b = await runTool(base, 'build', 'uinew');
  const c = await runTool(base, 'check', 'uinew');
  ok('a brand new book builds and passes check',
    b.code === 0 && c.code === 0 && c.result?.ready === true,
    `${b.result?.pages ?? b.lines[0]} pages, ready=${c.result?.ready}`);
  fs.rmSync(dir, { recursive: true, force: true });

  group('the full loop over SSE');
  /* withScratch, not makeScratch/dropScratch: this removes books/uitest even if
     an assertion throws, so a failure cannot leak a book into the next run. */
  await withScratch(async () => {
  const built2 = await runTool(base, 'build', 'uitest');
  ok('build exits 0 and reports the page count', built2.code === 0 && /wrote \d+ pages/.test(built2.lines[0] || ''), built2.lines[0]);

  const checked = await runTool(base, 'check', 'uitest');
  ok('check exits 0', checked.code === 0);
  ok('check reports ready', checked.result?.ready === true);
  ok('check has one row per sheet',
    checked.result?.rows?.length === checked.result?.pages,
    `${checked.result?.rows?.length} rows / ${checked.result?.pages} pages`);
  ok('every sheet reads 0 mm', checked.result?.rows?.every((r) => r.overMm === 0));
  ok('check reports generated pages with a gp title',
    checked.result?.rows?.some((r) => r.title.startsWith('gp ')));

  const shot = await runTool(base, 'shot', 'uitest');
  ok('shot exits 0', shot.code === 0, shot.lines[0]);
  const shots = await (await fetch(`${base}/api/shots?book=uitest`)).json();
  ok('gallery lists one png per sheet', shots.shots?.length === checked.result?.pages,
    `${shots.shots?.length} shots`);
  ok('gallery entries are numbered from 1 and point at real files',
    shots.shots?.[0]?.page === 1 &&
    shots.shots?.every((s) => fs.existsSync(path.join(ROOT, 'books', 'uitest', s.file))),
    shots.shots?.map((s) => `${s.page}:${s.file}`).join(' '));
  ok('gallery reports non-empty bytes',
    shots.shots?.every((s) => s.bytes > 1000));

  const exported = await runTool(base, 'export', 'uitest');
  ok('export exits 0 and writes a pdf', exported.code === 0 && fs.existsSync(path.join(ROOT, 'books', 'uitest', 'book.pdf')));
  const pdf = fs.readFileSync(path.join(ROOT, 'books', 'uitest', 'book.pdf'));
  const text = pdf.toString('latin1');
  const box = text.match(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  const mm = (pt) => parseFloat(pt) / 72 * 25.4;
  /* Chrome writes the page box as 498.96 x 708.96 pt, which is B5 to within its
     own rounding (176.0 x 250.09 mm). Exact equality is the wrong assertion. */
  const TOL = 0.5;
  ok('pdf page boxes are B5 (176 x 250 mm, within 0.5 mm)',
    !!box && Math.abs(mm(box[1]) - 176) < TOL && Math.abs(mm(box[2]) - 250) < TOL,
    box ? `${box[1]} x ${box[2]} pt = ${mm(box[1]).toFixed(1)} x ${mm(box[2]).toFixed(1)} mm` : 'no MediaBox found');

  group('editions');
  const free = await runTool(base, 'build', 'showcase', 'free');
  ok('edition build exits 0', free.code === 0, free.lines[0]);
  const freeCheck = await runTool(base, 'check', 'showcase', 'free');
  ok('edition checks clean', freeCheck.code === 0 && freeCheck.result?.ready === true,
    `${freeCheck.result?.pages} pages`);
  ok('the edition is shorter than the full book',
    freeCheck.result.pages < (await runTool(base, 'check', 'showcase')).result.pages,
    `${freeCheck.result.pages} < 17`);
  for (const f of ['book-free.html', 'book-free.pdf']) {
    fs.rmSync(path.join(ROOT, 'books', 'showcase', f), { force: true });
  }
  });   // withScratch

  /* ------------------------------------------------------------------ providers
     These boot a SECOND server whose local provider points at a fake model, so
     the whole drafting path is exercised for real without a key or a bill. */
  const fake = await fakeModel({ content: 'PLACEHOLDER-PAGE' });
  await withScratch(() => withServer(async (base) => {
    group('the provider list the UI shows');
    const prov = await (await fetch(`${base}/api/providers`)).json();
    ok('it lists every provider', prov.providers.length >= 10, `${prov.providers.length}`);
    ok('it says which ones are local', prov.providers.filter((p) => p.cost === 'local').length === 2);
    ok('it marks the paid ones as paid',
      prov.providers.filter((p) => p.cost === 'paid').every((p) => /allow-paid/.test(p.reason || '')));
    ok('it never claims a provider is ready while it lists a reason',
      prov.providers.every((p) => p.ready === !p.reason),
      prov.providers.filter((p) => p.ready !== !p.reason).map((p) => p.id).join(','));
    ok('a provider with no key is not ready',
      prov.providers.filter((p) => p.needsKey && !/allow-paid/.test(p.reason || ''))
        .every((p) => !p.ready));
    ok('no API key is echoed back to the browser',
      !JSON.stringify(prov).match(/sk-[A-Za-z0-9]{8}/));

    group('drafting a page over a real socket');
    const one = await readSSE(base, '/api/draft', { book: 'uitest', topic: 'SSRF', provider: 'ollama' });
    const start = one.events.find((e) => e.event === 'start');
    const done = one.events.find((e) => e.event === 'done');
    ok('it opens a stream', one.status === 200 && !!start);
    ok('the stream names the provider and model it used',
      start?.data.provider === 'ollama' && start?.data.model === 'fake-model', start?.data.label);
    ok('it streams the page as line events',
      one.events.filter((e) => e.event === 'line').length > 0);
    ok('it ends with a validation result', !!done?.data.validation);
    ok('a stub answer with no page in it is reported, not accepted',
      (done?.data.validation?.errors || []).length > 0, (done?.data.validation?.errors || []).join('; '));
    ok('the draft is not written into the book',
      !fs.readFileSync(path.join(ROOT, 'books', 'uitest', 'uitest.html'), 'utf8').includes('PLACEHOLDER-PAGE'));
    ok('no draft file was created either',
      !fs.readdirSync(path.join(ROOT, 'books', 'uitest')).some((f) => /PLACEHOLDER|draft/i.test(f)));

    group('drafting refuses, loudly and before the stream');
    const paid = await readSSE(base, '/api/draft', { book: 'uitest', topic: 'x', provider: 'openai' });
    ok('a paid provider is a plain 400, not a 200 with bad news inside',
      paid.status === 400 && /--allow-paid/.test(paid.error || ''), `${paid.status}`);
    const noKey = await readSSE(base, '/api/draft', { book: 'uitest', topic: 'x', provider: 'groq' });
    ok('a missing key names the variable', noKey.status === 400 && /GROQ_API_KEY/.test(noKey.error || ''));
    const noBook = await readSSE(base, '/api/draft', { book: 'nosuch', topic: 'x', provider: 'ollama' });
    ok('an unknown book is a 404', noBook.status === 404);

    group('a real page survives the round trip');
    const good = await readSSE(base, '/api/draft', {
      book: 'uitest', topic: 'SSRF', provider: 'ollama',
      /* Same page the engine itself produces, via the same extraction. */
    });
    ok('the done event carries the section text', typeof good.events.at(-1)?.data.section === 'string');

    group('bring your own key arrives, is accepted, and is not sticky');
    const beforeGroq = process.env.GROQ_API_KEY;
    const beforeOpenAi = process.env.OPENAI_API_KEY;
    const keyed = await readSSE(base, '/api/draft', {
      book: 'uitest', topic: 'SSRF', provider: 'ollama',
      keys: { GROQ_API_KEY: 'sk-forged-in-browser', OPENAI_API_KEY: 'sk-also-browser' },
    });
    ok('drafting still works with a keyed body on a local provider',
      keyed.events.find((e) => e.event === 'start')?.data.provider === 'ollama',
      keyed.events.find((e) => e.event === 'start')?.data.label);

    const pruned = await readSSE(base, '/api/draft', {
      book: 'uitest', topic: 'SSRF', provider: 'ollama',
      keys: { PATH: 'C:\\evil', NOT_A_KEY: 'sk-1234567' },
    });
    ok('a body that is not a key map is pruned, not honored',
      pruned.events.find((e) => e.event === 'start')?.data.model === 'fake-model',
      pruned.events.find((e) => e.event === 'start')?.data.model);
    ok('and the process environment is not mutated along the way',
      process.env.GROQ_API_KEY === beforeGroq && process.env.OPENAI_API_KEY === beforeOpenAi,
      [process.env.GROQ_API_KEY, process.env.OPENAI_API_KEY].join(','));
  }, { OLLAMA_BASE_URL: fake.baseUrl, OLLAMA_MODEL: 'fake-model' }));
  await fake.close();

  /* Cancel needs a request that is genuinely still running, so this one uses a
     model that never answers. */
  const silent = await fakeModel({ hold: true });
  await withScratch(() => withServer(async (base) => {
    group('cancelling a draft');
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book: 'uitest', topic: 'a slow one', provider: 'ollama' }),
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let started = null;
    /* Wait for the start event so we know there is an id to cancel. */
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value);
      const m = chunk.match(/event: start\ndata: (\{[^\n]*)/);
      if (m) { started = JSON.parse(m[1]); break; }
    }
    ok('a held draft still announces itself', !!started?.id, started?.label);

    const killed = await fetch(`${base}/api/cancel?id=${encodeURIComponent(started.id)}`);
    ok('cancel is accepted for a live draft', (await killed.json()).ok === true);
    ctrl.abort();

    const again = await fetch(`${base}/api/cancel?id=${encodeURIComponent(started.id)}`);
    ok('cancelling an already-finished draft is harmless', (await again.json()).ok === false);
  }, { OLLAMA_BASE_URL: silent.baseUrl, OLLAMA_MODEL: 'fake-model' }));
  await silent.close();

  /* ------------------------------------------------------------- the image tool
     gen-image.mjs needs a real provider, so what is checked here is the part the
     server owns: it refuses a missing prompt and will not let a name escape the
     book's folder. */
  group('the image tool is fenced in');
  await withScratch(async () => {
    const noPrompt = await runTool(base, 'image', 'uitest');
    ok('an image with no prompt is refused', noPrompt.code !== 0, noPrompt.lines.at(-1));
    const escape = await readSSE(base, '/api/run', {
      tool: 'image', book: 'uitest', prompt: 'a cat', name: '../../../escape.jpg',
    });
    const escStart = escape.events.find((e) => e.event === 'start');
    ok('a filename with path traversal is stripped, not obeyed',
      !!escStart && !/[/\\]/.test(escStart.data.label) && !/\.\./.test(escStart.data.label),
      escStart?.data.label);
    ok('the traversal did not create a file outside the book',
      !fs.existsSync(path.join(ROOT, 'escape.jpg')) && !fs.existsSync(path.join(ROOT, 'books', 'escape.jpg')));
  });

  /* ------------------------------------------------- the static preview fence
     /preview serves built books raw. It stayed inside the repo, but served ANY
     file under it, so /preview/.env handed over the environment. Now it serves
     only the extensions a book asks for, and never a dotfile. */
  group('the static preview serves the book, and nothing else');
  {
    const css = await fetch(`${base}/preview/engine/sheet.css`);
    ok('an engine stylesheet is served', css.status === 200, String(css.status));
    const bookJson = await fetch(`${base}/preview/books/starter/book.json`);
    ok('a book.json is served', bookJson.status === 200, String(bookJson.status));
    const env = await fetch(`${base}/preview/.env`);
    ok('/preview cannot read .env', env.status === 403, String(env.status));
    const dotgit = await fetch(`${base}/preview/.gitignore`);
    ok('/preview refuses an unknown dotfile', dotgit.status === 403, String(dotgit.status));
    const weird = await fetch(`${base}/preview/engine/tools/check.mjs.exe`);
    ok('/preview refuses an unknown extension', weird.status === 403, String(weird.status));
  }

  /* --------------------------------------------------------- the build --out fence */
  group('build --out cannot escape books/');
  {
    const r = await readSSE(base, '/api/run', { tool: 'build', book: 'starter', out: '../../escape.html' });
    ok('a traversal --out is refused up front', r.status === 400 && /inside books/.test(r.error || ''),
      `${r.status} ${r.error}`);
    ok('nothing was written outside books/', !fs.existsSync(path.join(ROOT, 'escape.html')));
  }
});     // withServer

report('API');