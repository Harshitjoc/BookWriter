/* ==========================================================================
   test/ui.test.mjs  -  the cockpit in a real browser
   --------------------------------------------------------------------------
   Run:  node tests/ui.test.mjs

   Every assertion here exists because its absence let a real bug through.
   The zoom slider and the sheet-jump box were BOTH untested, which is how a
   ReferenceError shipped in Preview.jsx and survived. Do not delete a test
   without replacing it.
   ========================================================================== */
import { group, ok, report, withServer, withScratch, cleanStale, fakeModel, ROOT } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import('playwright');
const { extractSection } = await import('../src/engine/tools/draft-block.mjs');

cleanStale();

/* A fake model on a real socket, so the draft panel is driven for real rather
   than mocked. It answers with a genuine engine page taken from books/starter,
   with one number replaced by a [FACT NEEDED] marker so the gap path is real
   too: that is what a model that refuses to guess looks like.

   The starter's hand-authored page carries a TELL THE AI box; the engine refuses
   that on a generated page, so the fixture is stripped the same way draft.test
   strips it — a draft never carries that furniture.

   The title is RENAMED too. A draft that re-uses a real page's title would make
   build-book.mjs refuse the whole book ("titles have to be unique"), so a draft
   worth reading must be titled anew anyway; the fixture teaches the panel what
   a properly-fresh draft looks like, and keeps the book buildable afterwards. */
const REAL_PAGE = extractSection(
  fs.readFileSync(path.join(ROOT, 'books', 'starter', 'starter.html'), 'utf8')
    .replace(/\s*<div class="ask">[\s\S]*?<\/div>/, '')
    .replace(/<h1 class="title">\s*SSRF\s*<\/h1>/, '<h1 class="title">Link-local metadata</h1>')
).replace('169.254.169.254', '[FACT NEEDED: the link-local metadata address]');

const fake = await fakeModel({ content: REAL_PAGE });

await withServer(async (base) => {
  await withScratch(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

    const errors = [];
    const bad4xx = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
    page.on('requestfailed', (r) => errors.push(`REQFAIL: ${r.url()} ${r.failure()?.errorText || ''}`));
    page.on('response', (r) => { if (r.status() >= 400) bad4xx.push(`${r.status()} ${r.url()}`); });

    try {
      await page.goto(base, { waitUntil: 'networkidle' });

      group('mounts');
      ok('React mounted', await page.locator('.app').count() > 0);
      await page.waitForSelector('.monaco-editor', { timeout: 30000 });
      ok('Monaco rendered', await page.locator('.monaco-editor').count() > 0);
      ok('the browser pill says ready', (await page.locator('.pill-status').first().textContent() || '').includes('ready'));

      // pick the scratch book so nothing we do can touch a real book
      await page.selectOption('.top-mid select', 'uitest');
      await page.waitForTimeout(1200);

      /* The scratch book has no book.html yet. The cockpit must SAY that rather
         than pointing an iframe at a missing file: that produced a 404 in the
         console and a blank frame. */
      ok('an unbuilt book says so instead of showing a broken frame',
        /not built yet/i.test((await page.locator('.preview-wait').textContent()) || ''),
        ((await page.locator('.preview-wait').textContent()) || '').replace(/\s+/g, ' ').trim());
      ok('no iframe is mounted for an unbuilt book',
        await page.locator('.col-preview iframe').count() === 0);

      /* Click a step button and wait for it to finish. The buttons disable
         while a tool runs, so "not disabled" is the completion signal. The
         scratch book has no book.html until it is built, and the preview iframe
         shows book.html, so build has to happen before anything is asserted. */
      const runStep = async (label, ms = 90000) => {
        await page.locator('button.step', { hasText: label }).click();
        await page.waitForSelector('button.step:not([disabled])', { timeout: ms });
        await page.waitForTimeout(400);
      };

      /* The right column's tools live in four dropdown menus now, so reaching a
         panel is two clicks: open its group, then pick the tool. */
      const PICK = {
        check: ['measure', 'check'], board: ['measure', 'board'],
        dashboard: ['measure', 'dashboard'], shots: ['measure', 'shots'],
        diagram: ['make', 'diagram'], draft: ['make', 'draft'],
        photo: ['make', 'assets'], 'from source': ['make', 'source'],
        export: ['ship', 'export'], publish: ['ship', 'publish'],
        console: ['system', 'console'], keys: ['system', 'keys'],
      };
      const pickTab = async (name) => {
        const [group, id] = PICK[name];
        await page.locator(`.tab-grp[data-group="${group}"] .tab-grp-btn`).click();
        await page.locator(`.tab-menu [data-tab="${id}"]`).click();
        await page.waitForTimeout(150);
      };

      await runStep('build');
      ok('build produced a previewable book', true);

      group('source files');
      const tabs = await page.locator('.col-edit .tab').allTextContents();
      ok('all four source files are listed', tabs.length === 4, tabs.join(', '));
      ok('the interior tab is named after the book, not hardcoded',
        tabs[1].includes('uitest.html'), tabs[1]);

      group('the preview is the real book, not a mock');
      const frame = () => page.frameLocator('.col-preview iframe');
      await frame().locator('.sheet').first().waitFor({ timeout: 20000 });
      const sheets = await frame().locator('.sheet').count();
      ok('every sheet rendered in the preview', sheets === 6, `${sheets} sheets`);
      const desk = await frame().locator('body').evaluate((b) => getComputedStyle(b).backgroundColor);
      ok('the engine stylesheet applied (dark desk, not unstyled)', desk !== 'rgba(0, 0, 0, 0)' && desk !== '', desk);
      const title = await frame().locator('.sheet.bb .title, .sheet.bb h1.title').first().textContent();
      ok('the page title came from the real interior', !!title?.trim(), (title || '').trim());

      group('the trim label is read from the book, not hardcoded  (new)');
      const note = (await page.locator('.preview-note').textContent() || '').trim();
      ok('the preview states the trim it measured', /176mm\s*×\s*250mm/.test(note), note);

      group('zoom slider  (regression: this used to throw ReferenceError)');
      const widthOf = () => page.locator('.col-preview iframe').evaluate((el) => el.getBoundingClientRect().width);
      const before = await widthOf();
      const beforePct = await page.locator('.zoom-val').textContent();
      await page.locator('.zoom').fill('1.2');
      await page.waitForTimeout(400);
      const after = await widthOf();
      const afterPct = await page.locator('.zoom-val').textContent();
      ok('dragging the slider resizes the preview', after > before + 10, `${beforePct} -> ${afterPct}, ${Math.round(before)}px -> ${Math.round(after)}px`);
      ok('the zoom readout tracks the slider', afterPct === '120%', afterPct);
      ok('no error was thrown while zooming', !errors.some((e) => /setZoom|is not defined/.test(e)),
        errors.filter((e) => /setZoom|is not defined/.test(e)).join(' | '));

      /* A wider iframe is not a zoom. Zooming has to reach the PAPER, or the
         slider is a viewport resize wearing a zoom label — which is exactly how
         it used to behave. The iframe keeps its width percentage (so the frame
         assertions above stay true) and the inner document carries the scale. */
      const innerZoom = await page.frameLocator('.col-preview iframe').locator('html')
        .evaluate((h) => h.style.zoom);
      ok('the zoom reaches the paper itself, not just the frame', innerZoom === '1.2', `html zoom="${innerZoom}"`);
      const sheetW = () => page.frameLocator('.col-preview iframe').locator('.sheet')
        .first().evaluate((el) => el.getBoundingClientRect().width);
      const wide = await sheetW();
      await page.locator('.zoom').fill('0.6');
      await page.waitForTimeout(300);
      const narrow = await sheetW();
      ok('the sheet really scales with the slider',
        wide > narrow * 1.9, `${Math.round(wide)}px at 120% vs ${Math.round(narrow)}px at 60%`);

      group('sheet jump  (regression: this also used to throw)');
      const topOf = () => page.frameLocator('.col-preview iframe').locator('body')
        .evaluate((b) => (b.ownerDocument.scrollingElement || b.ownerDocument.documentElement).scrollTop);
      ok('preview starts at the top', (await topOf()) === 0, `scrollTop=${await topOf()}`);
      await page.locator('.jump input').fill('4');
      await page.locator('.jump input').press('Enter');
      await page.waitForTimeout(700);
      const scrolled = await topOf();
      ok('Enter in the jump box scrolls the preview', scrolled > 100, `scrollTop=${Math.round(scrolled)}`);
      ok('no error was thrown while jumping', !errors.some((e) => /setPage|is not defined/.test(e)),
        errors.filter((e) => /setPage|is not defined/.test(e)).join(' | '));

      group('run the tools from the UI');
      await runStep('check');
      await pickTab('check');
      await page.waitForSelector('.verdict', { timeout: 30000 });
      ok('check shows a verdict', (await page.locator('.verdict').textContent() || '').includes('All pages fit'));
      const rows = await page.locator('.check table.rows tbody tr').count();
      ok('one row per sheet', rows === 6, `${rows} rows`);
      ok('a check row can be reached from the keyboard',
        (await page.locator('.check table.rows tbody tr').first().getAttribute('tabindex')) === '0');
      const overs = await page.locator('.check table.rows tbody tr td.num').allTextContents();
      ok('every row reads 0 mm', overs.every((t) => t.trim() === '0'), overs.join(','));

      /* The cockpit takes the deep pass too, so the check panel carries the
         lint findings, not just the millimetre measurements. */
      await page.waitForSelector('.check .lint', { timeout: 30000 });
      ok('the deep pass is rendered under the check table',
        /deep pass/.test(await page.locator('.check .lint-head').textContent() || ''));

      /* The console is cleared at the start of every non-quiet step (App.jsx), so it
         always shows the LAST command only. Assert against the step just run,
         not against every step that ever ran. */
      const consoleText = async () =>
        (await page.locator('.console-body').textContent()) || '';
      await pickTab('console');
      await page.waitForTimeout(400);
      ok('the console shows the command it just ran',
        /\bcheck\b/.test(await consoleText()), (await consoleText()).replace(/\s+/g, ' ').slice(0, 60));

      await pickTab('shots');
      await runStep('shot');
      await page.waitForSelector('.thumbs .thumb img', { timeout: 30000 });
      const thumbs = await page.locator('.thumbs .thumb img').count();
      ok('the gallery lists one thumbnail per sheet', thumbs === 6, `${thumbs} thumbs`);
      const loaded = await page.locator('.thumbs .thumb img').first()
        .evaluate((el) => el.complete && el.naturalWidth > 0);
      ok('the first thumbnail actually loads', loaded);

      await pickTab('console');
      await page.waitForTimeout(400);
      ok('the console switches to the newest command',
        /\bshot\b/.test(await consoleText()), (await consoleText()).replace(/\s+/g, ' ').slice(0, 60));
      ok('the console does not dump raw --json at the reader',
        !/\{"check"/.test(await consoleText()));

      group('edit and save a real file');
      await page.locator('.col-edit .tab').nth(2).click();          // VOICE.md
      await page.waitForTimeout(1000);
      const original = await page.evaluate(async () =>
        (await (await fetch('/api/file?book=uitest&name=VOICE.md')).json()).text);
      await page.locator('.col-edit .monaco-editor').click();
      await page.keyboard.press('Control+End');
      /* insertText, not type(). Typing fires one event per character and Monaco
         can drop one under load, which showed up as a 1-char-short save.
         Plain letters only: "<!--" makes Monaco auto-close every character,
         which mangled an earlier probe into "<!>-ui-rb >". */
      await page.keyboard.insertText('uitestmarker');
      await page.waitForSelector('.mini.primary:not([disabled])', { timeout: 5000 });
      await page.locator('.mini.primary').click();
      await page.waitForSelector('.saved', { timeout: 20000 });
      ok('save reports success', ((await page.locator('.saved').textContent()) || '').includes('VOICE.md saved'));
      const saved = await page.evaluate(async () =>
        (await (await fetch('/api/file?book=uitest&name=VOICE.md')).json()).text);
      ok('the edit reached disk, exactly as typed',
        saved === original + 'uitestmarker',
        `${original.length} -> ${saved.length}`);
      await page.waitForTimeout(2500);
      ok('the auto-build does not yank the editor to another file',
        ((await page.locator('.col-edit .tab.on').textContent()) || '').includes('VOICE.md'),
        ((await page.locator('.col-edit .tab.on').textContent()) || '').trim());
      await page.evaluate(async (t) => {
        await fetch('/api/file?book=uitest&name=VOICE.md', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t }),
        });
      }, original);
      const restored = await page.evaluate(async () =>
        (await (await fetch('/api/file?book=uitest&name=VOICE.md')).json()).text);
      ok('the file is restored byte for byte', restored === original,
        `${restored.length} vs ${original.length} chars`);

      group('open pdf exports first, then opens');
      /* This used to be an <a href>, which began fetching the PDF at click time,
         while export.mjs was still writing it. It is a button now. */
      ok('it is a button, not an anchor',
        await page.locator('button.step.link').count() === 1 &&
        await page.locator('a.step.link').count() === 0);
      ok('the old anchor is gone from the toolbar',
        await page.locator('.toolbar a[href$=".pdf"]').count() === 0);

      group('the draft panel');
      await pickTab('draft');
      await page.waitForSelector('.draft-form select', { timeout: 15000 });

      const options = await page.locator('.draft-form select').first().locator('option').allTextContents();
      ok('the provider list is populated', options.length >= 10, `${options.length} providers`);
      ok('paid providers are labelled paid in the list',
        options.some((o) => /OpenAI.*PAID/.test(o)), options.find((o) => /OpenAI/.test(o)));

      ok('it starts on a local, free provider',
        await page.locator('.draft-form select').first().inputValue() === 'ollama',
        await page.locator('.draft-form select').first().inputValue());

      /* The draft button must be dead until there is something to write about. */
      ok('draft is disabled with no topic',
        await page.locator('.draft-actions button.mini.primary').isDisabled());
      await page.locator('.draft-form input').nth(1).fill('How a CDN works');
      ok('draft is enabled once there is a topic',
        await page.locator('.draft-actions button.mini.primary').isEnabled());

      await page.locator('.draft-actions button.mini.primary').click();
      await page.waitForSelector('.draft-out', { timeout: 30000 });
      const draftText = await page.locator('.draft-out').textContent();
      ok('a real page comes back in the panel', (draftText || '').includes('<section class="sheet bb">'));
      ok('the page is the one the engine itself produces',
        (draftText || '').includes('Server-side request forgery'));
      const report1 = (await page.locator('.draft-report').textContent()) || '';
      ok('it passes the engine\'s own checks',
        /matches the engine/i.test(report1), report1.replace(/\s+/g, ' ').slice(0, 90));
      ok('an unfilled fact is called out, not hidden',
        /FACT NEEDED/.test(report1), report1.replace(/\s+/g, ' ').slice(0, 120));
      ok('a gap does not block adding it', await page.locator('.draft-actions button.mini.primary').nth(1).isEnabled());

      const interiorBefore = await page.evaluate(async () =>
        (await (await fetch('/api/file?book=uitest&name=uitest.html')).json()).text);
      ok('drafting did not touch the interior file',
        !interiorBefore.includes('FACT NEEDED'));

      group('adding an approved draft to the book');
      const sheetsBefore = await frame().locator('.sheet').count();
      await page.locator('.draft-actions button.mini.primary').nth(1).click();
      await page.waitForTimeout(2500);
      const interiorAfter = await page.evaluate(async () =>
        (await (await fetch('/api/file?book=uitest&name=uitest.html')).json()).text);
      ok('the interior file grew by exactly one page',
        (interiorAfter.match(/<section class="sheet bb">/g) || []).length ===
        (interiorBefore.match(/<section class="sheet bb">/g) || []).length + 1);
      ok('the page landed inside <main>, not after it',
        interiorAfter.indexOf('FACT NEEDED') < interiorAfter.indexOf('</main>'));
      ok('the UI says the title still needs adding to book.json',
        /book\.json/.test((await page.locator('.notice').first().textContent()) || ''));
      /* build-book.mjs only emits pages listed in book.json, so the sheet count
         must NOT have gone up yet. This is the guard that keeps a draft from
         silently inventing a table of contents. */
      await page.waitForTimeout(1200);
      ok('the preview did not gain a sheet until book.json lists it',
        await frame().locator('.sheet').count() === sheetsBefore,
        `${sheetsBefore} sheets`);
      ok('the source file was not written with the title',
        !(await page.evaluate(async () =>
          (await (await fetch('/api/file?book=uitest&name=book.json')).json()).text)).includes('FACT NEEDED'));

      group('a paid provider asks before it is used');
      await page.selectOption('.draft-form select', 'openai');
      await page.waitForSelector('.paid-warn', { timeout: 5000 });
      const warn = (await page.locator('.paid-warn').textContent()) || '';
      ok('picking a paid provider shows a warning in words',
        /bills every token/i.test(warn), warn.replace(/\s+/g, ' ').slice(0, 80));
      ok('the warning only appears for a paid provider',
        await page.locator('.paid-warn').count() === 1);
      await page.selectOption('.draft-form select', 'ollama');
      await page.waitForTimeout(300);
      ok('switching back to a local provider removes the warning',
        await page.locator('.paid-warn').count() === 0);

      group('the photo panel');
      await pickTab('photo');
      await page.waitForSelector('.draft-form input', { timeout: 10000 });
      ok('it warns that diagrams are not photographs',
        /inline SVG/i.test((await page.locator('.col-out .out-body .hint').first().textContent()) || ''));
      ok('generate is disabled with no prompt',
        await page.locator('.col-out .out-body button.mini.primary').isDisabled());

      group('the diagram studio');
      await pickTab('diagram');
      await page.waitForSelector('.studio-svg svg', { timeout: 15000 });
      ok('a compiled diagram renders as SVG', await page.locator('.studio-svg svg').count() === 1);
      const shapeOpts = await page.locator('.studio .draft-form select option').allTextContents();
      ok('every shape is offered', shapeOpts.length === 9, `${shapeOpts.length} shapes`);
      const spec0 = await page.locator('.studio-spec textarea').inputValue();
      ok('the spec box holds real JSON', /"kind"\s*:/.test(spec0), spec0.slice(0, 40));

      /* Pick another shape and the example spec + preview swap together. */
      await page.selectOption('.studio .draft-form select', 'funnel');
      await page.waitForTimeout(600);
      ok('choosing a shape loads its example',
        /"kind"\s*:\s*"funnel"/.test(await page.locator('.studio-spec textarea').inputValue()));
      ok('the preview still compiles', await page.locator('.studio-svg svg').count() === 1);

      /* Edit the spec and the SVG follows. A valid edit only: an invalid one is a
         400, which the "no 4xx" check would rightly flag in the browser. */
      const edited = (await page.locator('.studio-spec textarea').inputValue())
        .replace('{', '{"aria":"a funnel the studio just compiled",');
      await page.locator('.studio-spec textarea').fill(edited);
      await page.waitForTimeout(800);
      /* aria is on the <svg> root, so read the attribute, not innerHTML. */
      const aria = await page.locator('.studio-svg svg').getAttribute('aria-label');
      ok('editing the spec recompiles the preview',
        aria === 'a funnel the studio just compiled', aria || '(none)');

      group('the board');
      await pickTab('board');
      await page.waitForSelector('.board-table tbody tr', { timeout: 15000 });
      const boardRows = await page.locator('.board-table tbody tr').count();
      /* The board reads the interior SOURCE: the book pages, not the generated
         cover/contents/divider furniture. The scratch interior holds the one
         starter page plus the page the draft panel just added. */
      ok('the board lists the source pages', boardRows >= 2, `${boardRows} rows`);
      ok('the board shows its totals', await page.locator('.board-stat').count() >= 5);
      ok('a board row names a real page title',
        (await page.locator('.board-table tbody tr').first().textContent() || '').includes('SSRF'));

      group('print-craft toggles: gutter, bleed, recto');
      /* The three switches are off by default, so a plain build is byte-for-byte
         the same with or without the cockpit. Turn all of them on, rebuild, read
         the built file back, then turn them off again and prove a plain build
         comes back. */
      const builtHtml = () => page.evaluate(async () =>
        await (await fetch('/preview/books/uitest/book.html')).text());
      const craftCheck = (label) =>
        page.locator('.toolbar label.craft-ck', { hasText: label }).locator('input');
      await craftCheck('gutter').check();
      await craftCheck('bleed').check();
      await craftCheck('recto').check();
      await page.locator('.toolbar input[title="gutter in mm"]').fill('8');
      await page.locator('.toolbar input[title="bleed in mm"]').fill('3');
      await runStep('build');
      let built = await builtHtml();
      ok('a crafted build puts the gutter rule in book.html',
        /--gutter 8mm/.test(built) && /nth-child\(odd\)\{ padding-left/.test(built), '');
      ok('a crafted build bleeds the paper into the trim',
        /--bleed 3mm/.test(built) && /box-shadow:0 0 0 3mm var\(--paper\)/.test(built), '');
      ok('a crafted build opens every part on a recto',
        /class="sheet gp blank"/.test(built), '');
      await craftCheck('gutter').uncheck();
      await craftCheck('bleed').uncheck();
      await craftCheck('recto').uncheck();
      await runStep('build');
      built = await builtHtml();
      ok('switching the craft off restores a plain build',
        !/--gutter|--bleed|sheet gp blank/.test(built), '');

      group('the dashboard');
      await pickTab('dashboard');
      await page.waitForSelector('.dash-cards .dash-card', { timeout: 15000 });
      const dashTitle = await page.locator('.dash-head h2').textContent();
      ok('the dashboard names the book', !!dashTitle?.trim(), (dashTitle || '').trim());
      const dash = (await page.locator('.dash-cards .dash-card').allTextContents())
        .map((t) => t.replace(/\s+/g, ' ').trim()).join('\n');
      ok('the open fact is flagged, not hidden', /1\s*open facts/.test(dash), dash);
      ok('the page not in book.json is counted', /1\s*pages not in book\.json/.test(dash), dash);
      ok('the listed count shows pages in the book', /1\s*\/\s*2\s*pages in the book/.test(dash), dash);
      ok('the parts table is rendered',
        await page.locator('.dash-parts tbody tr').count() >= 1);
      const artifacts = (await page.locator('.dash-artifacts').textContent()) || '';
      ok('no artifact is claimed before any export',
        /use the publish tab/.test(artifacts), artifacts.replace(/\s+/g, ' ').trim());

      group('the export panel');
      await pickTab('export');
      await page.waitForSelector('.export .export-formats button.mini.primary', { timeout: 10000 });
      ok('the export hint explains the reflows',
        /EPUB reflows/i.test(await page.locator('.export .hint').first().textContent() || ''));
      ok('the panel defaults to the PDF',
        await page.locator('.export-formats .chip-ck', { hasText: 'pdf' }).locator('input').isChecked());
      await page.locator('.export-formats .chip-ck', { hasText: 'epub' }).locator('input').check();
      await page.locator('.export-formats .chip-ck', { hasText: 'web' }).locator('input').check();
      await page.locator('.export-formats button.mini.primary').click();
      await page.waitForSelector('.export-formats button.mini.primary:not([disabled])', { timeout: 120000 });
      const exportError = (await page.locator('.export .alert').count())
        ? await page.locator('.export .alert').textContent() : '';
      ok('the export batch reports no failure', exportError === '', exportError || '');
      const links = await page.locator('.export-links .chip-link').allTextContents();
      ok('every exported file is linked', links.length === 3, links.join(', '));
      const epubBytes = await page.evaluate(async () =>
        (await (await fetch('/preview/books/uitest/book.epub')).arrayBuffer()).byteLength);
      ok('the epub is real data on disk', epubBytes > 1000, `${epubBytes} bytes`);
      await page.locator('.card-form input').fill('2');
      await page.locator('.card-form button', { hasText: 'export card' }).click();
      await page.waitForSelector('.card-form button:not([disabled])', { timeout: 120000 });
      const cardBytes = await page.evaluate(async () =>
        (await (await fetch('/preview/books/uitest/card-2.html')).arrayBuffer()).byteLength);
      ok('card-2.html reaches disk', cardBytes > 100, `${cardBytes} bytes`);

      group('the publish gate refuses a book with open facts');
      await pickTab('publish');
      await page.waitForSelector('.publish .export-formats button.mini.primary', { timeout: 10000 });
      ok('publish shows the hard gate in words',
        /Nothing is written until every check passes/.test(await page.locator('.publish .hint').textContent() || ''));
      await page.locator('.publish .export-formats button.mini.primary').click();
      await page.waitForSelector('.publish .alert', { timeout: 120000 });
      const refused = (await page.locator('.publish .alert').textContent()) || '';
      ok('the refusal is a normal message, not a crash', /publish stopped/.test(refused), refused);
      const gate = (await page.locator('.publish .draft-out').textContent()) || '';
      ok('the gate names the open fact', /open fact/.test(gate), gate.replace(/\s+/g, ' ').slice(0, 100));

      group('a seeded draft is written to the ledger and then replays');
      await pickTab('draft');
      await page.waitForSelector('.draft-form input', { timeout: 15000 });
      await page.locator('.draft-form input').nth(1).fill('How a CDN works');
      await page.locator('.draft-form input[type="number"]').fill('7');
      await page.locator('.draft-actions button.mini.primary').first().click();
      await page.waitForSelector('.draft-meta', { timeout: 30000 });
      const meta1 = (await page.locator('.draft-meta').textContent()) || '';
      ok('the run is recorded in the .gen ledger',
        /ledger/.test(meta1), meta1.replace(/\s+/g, ' ').slice(0, 60));
      ok('the seed is shown as fixing the page',
        /seed 7 fixes this page/.test(meta1.replace(/\s+/g, ' ')), meta1.replace(/\s+/g, ' ').slice(0, 80));
      await page.locator('.draft-actions button.mini.primary').first().click();
      await page.waitForSelector('.draft-meta .ok', { timeout: 30000 });
      const meta2 = (await page.locator('.draft-meta').textContent()) || '';
      ok('an identical re-draft replays from the ledger, byte for byte',
        /replayed from the ledger/.test(meta2), meta2.replace(/\s+/g, ' ').slice(0, 80));

      /* -------------------------------------------------- panels and deleting.
         The side panels can be collapsed to hand the middle the whole width,
         and dragged to a size the reader picks. And a project can be deleted
         outright — the API is fussy about it and the cockpit makes you type the
         slug first, because a folder of finished pages has no undo. */

      group('the side panels close, resize and come back');
      const previewW = () => page.locator('.col-preview').evaluate((el) => el.getBoundingClientRect().width);
      const editVisible = () => page.locator('.col-edit').isVisible();

      ok('both side panels start open', (await page.locator('.splitter').count()) === 2,
        `${await page.locator('.splitter').count()} dividers`);
      const beforeCollapse = await previewW();

      await page.locator('.col-edit .iconbtn').click();
      await page.waitForTimeout(250);
      ok('hiding the source panel takes its column away', !(await editVisible()));
      ok('and leaves a rail to bring it back', await page.locator('.rail-left').isVisible());
      ok('the middle grows into the space the source panel left',
        (await previewW()) > beforeCollapse + 100, `${Math.round(beforeCollapse)} -> ${Math.round(await previewW())}`);
      ok('the editor is hidden, not torn down', (await page.locator('.col-edit .monaco-editor').count()) >= 1);

      await page.locator('.rail-left').click();
      await page.waitForTimeout(250);
      ok('the rail brings the source panel back', await editVisible());

      const beforeKey = await previewW();
      const divider = page.locator('.splitter').first();
      await divider.focus();
      await divider.press('ArrowRight');
      await page.waitForTimeout(200);
      ok('the keyboard nudges the divider', (await previewW()) < beforeKey - 10,
        `${Math.round(beforeKey)} -> ${Math.round(await previewW())}`);
      ok('the divider announces itself to assistive tech',
        (await divider.getAttribute('role')) === 'separator'
        && /^\d+$/.test((await divider.getAttribute('aria-valuenow')) || ''));

      await page.locator('.col-out .iconbtn').click();
      await page.waitForTimeout(250);
      ok('hiding the tools panel leaves a rail on the right', await page.locator('.rail-right').isVisible());
      ok('with both sides closed the middle owns the width',
        (await previewW()) > beforeCollapse + 200, `${Math.round(await previewW())}`);
      await page.locator('.rail-right').click();
      await page.waitForTimeout(250);
      ok('the tools panel comes back too', await page.locator('.col-out').isVisible());

      group('the project you were on survives a refresh');
      {
        const picker = page.locator('.top-mid select').first();
        await picker.selectOption('starter');
        await page.waitForTimeout(600);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('.monaco-editor', { timeout: 30000 });
        await page.waitForTimeout(400);
        ok('the cockpit reopens the project you left it on',
          (await picker.inputValue()) === 'starter', await picker.inputValue());

        /* A remembered slug whose book was deleted or renamed must not strand
           the cockpit on nothing: it falls back to a book that exists. */
        await page.evaluate(() => localStorage.setItem('proofpress.slug', 'ghost-book'));
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('.monaco-editor', { timeout: 30000 });
        await page.waitForTimeout(400);
        const value = await picker.inputValue();
        ok('a remembered project that is gone falls back to a real one',
          value !== 'ghost-book' && value !== '', value);
      }

      group('a project can be deleted, and only on purpose');
      const postJson = async (url, body) => {
        const r = await fetch(base + url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      };

      const made = await postJson('/api/new-book', { slug: 'uitest-del' });
      ok('a disposable project exists to delete', made.status === 200, JSON.stringify(made.body));
      const wrongWord = await postJson('/api/delete-book', { slug: 'uitest-del', confirm: 'nope' });
      ok('a delete that does not type the slug is refused', wrongWord.status === 400, `${wrongWord.status}`);
      const starterHit = await postJson('/api/delete-book', { slug: 'starter', confirm: 'starter' });
      ok('the starter template is never deletable', starterHit.status === 403, `${starterHit.status}`);
      const killed = await postJson('/api/delete-book', { slug: 'uitest-del', confirm: 'uitest-del' });
      ok('the typed slug deletes the whole folder',
        killed.status === 200 && killed.body.removed >= 1, JSON.stringify(killed.body));
      const listed = await (await fetch(base + '/api/books')).json();
      ok('and it is gone from the list', !listed.books.some((b) => b.slug === 'uitest-del'));
      const twice = await postJson('/api/delete-book', { slug: 'uitest-del', confirm: 'uitest-del' });
      ok('deleting it again is a 404, not a second delete', twice.status === 404, `${twice.status}`);

      /* The same delete, but driven from the dialog a person would use. */
      await postJson('/api/new-book', { slug: 'uitest-ui' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.monaco-editor', { timeout: 30000 });
      const bookSelect = page.locator('.top-mid select').first();
      await bookSelect.selectOption('starter');
      await page.waitForTimeout(400);
      ok('the template has no delete button to press',
        await page.locator('.top-mid .mini.danger').isDisabled());
      await bookSelect.selectOption('uitest-ui');
      await page.waitForTimeout(400);
      await page.locator('.top-mid .mini.danger').click();
      await page.waitForSelector('.modal', { timeout: 5000 });
      const armDelete = page.locator('.modal-actions .mini.danger');
      ok('the dialog will not delete until the slug is typed', await armDelete.isDisabled());
      await page.locator('.modal-field input').fill('nope');
      ok('a wrong word leaves it dead', await armDelete.isDisabled());
      await page.locator('.modal-field input').fill('uitest-ui');
      ok('the right word arms it', !(await armDelete.isDisabled()));
      await armDelete.click();
      await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
      ok('the project is gone from the picker',
        (await bookSelect.locator('option[value="uitest-ui"]').count()) === 0);
      ok('and the cockpit says what it did',
        /deleted books\/uitest-ui/i.test((await page.locator('.notice').textContent()) || ''));
      ok('the cockpit is left on a project that still exists',
        (await bookSelect.inputValue()) !== '', await bookSelect.inputValue());

      /* Belt and braces: the scratch cleaner only knows about `uitest`, so make
         sure the two books these tests made are gone whatever happened above. */
      for (const leftover of ['uitest-del', 'uitest-ui']) {
        fs.rmSync(path.join(ROOT, 'books', leftover), { recursive: true, force: true });
      }

      group('the new-book picker copies the template you choose');
      const newBtn = page.locator('.top-mid .mini', { hasText: 'new book' });
      if ((await page.locator('.newbook').count()) === 0) await newBtn.click();
      await page.waitForSelector('.newbook', { timeout: 5000 });
      const pick = page.locator('.newbook select.tpl-pick');
      await pick.waitFor({ timeout: 5000 });
      const labels = await pick.locator('option').allTextContents();
      ok('the picker offers a template per scaffold', labels.length >= 6, labels.join(' | '));
      ok('the default is the explainer starter', (await pick.inputValue()) === 'starter',
        await pick.inputValue());
      ok('each option names its theme and size',
        labels.some((l) => /cookbook\/b5/.test(l)) && labels.some((l) => /six-by-nine/.test(l)),
        labels.join(' | '));
      await pick.selectOption('cookbook');
      ok('choosing one explains what it is for',
        ((await page.locator('.newbook .tpl-note').textContent()) || '').trim().length > 0);
      await page.locator('.newbook input').fill('uitest-cook');
      await page.locator('.newbook button.primary').click();
      await page.waitForSelector('.newbook', { state: 'detached', timeout: 15000 });
      await page.waitForTimeout(400);
      ok('the cockpit says which template it used',
        /cookbook/i.test((await page.locator('.notice').textContent()) || ''));
      ok('and lands on the new book',
        (await page.locator('.top-mid select').first().inputValue()) === 'uitest-cook',
        await page.locator('.top-mid select').first().inputValue());
      ok('the scaffold on disk is the book, interior renamed to match',
        fs.existsSync(path.join(ROOT, 'books', 'uitest-cook', 'uitest-cook.html')));
      /* Move off the new book before removing it, so the preview never points at
         a folder that is gone (a 404 there would trip the closing assertion). */
      await page.locator('.top-mid select').first().selectOption('starter');
      await page.waitForTimeout(400);
      fs.rmSync(path.join(ROOT, 'books', 'uitest-cook'), { recursive: true, force: true });

      /* A panel collapsed on desktop must still exist on a phone, where the pane
         switcher — not the collapse state — decides what is on screen. */
      await page.locator('.col-edit .iconbtn').click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      await page.locator('.paneswitch button', { hasText: 'source' }).click();
      await page.waitForTimeout(250);
      ok('a panel collapsed on desktop is still reachable on a phone',
        await page.locator('.col-edit').isVisible());
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.waitForTimeout(300);
      ok('and back on desktop it is still collapsed, with a rail to reopen it',
        !(await page.locator('.col-edit').isVisible()) && await page.locator('.rail-left').isVisible());
      await page.locator('.rail-left').click();
      await page.waitForTimeout(250);
      ok('the rail reopens it after the trip', await page.locator('.col-edit').isVisible());

      /* ---------------------------------------------------------- a phone.
         The three columns cannot share 390px, so below 1100px the cockpit
         shows one at a time behind a switcher. Everything that was reachable
         on desktop must still be reachable here, and nothing may push the
         layout sideways. */
      group('the cockpit on a phone');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);

      const sideways = () => page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok('the phone layout does not overflow sideways', (await sideways()) <= 1, `${await sideways()}px over`);
      ok('the pane switcher appears where the columns cannot fit',
        await page.locator('.paneswitch').isVisible());

      const visibleCols = async () => {
        const out = [];
        for (const n of ['edit', 'preview', 'out']) {
          if (await page.locator(`.app .col-${n}`).isVisible()) out.push(n);
        }
        return out;
      };
      ok('exactly one pane is on screen at a time', (await visibleCols()).length === 1,
        (await visibleCols()).join(','));

      await page.locator('.paneswitch button', { hasText: 'source' }).click();
      await page.waitForTimeout(250);
      ok('the switcher brings up the editor', (await visibleCols()).join(',') === 'edit',
        (await visibleCols()).join(','));
      ok('the pressed pane is marked for assistive tech',
        ((await page.locator('.paneswitch button[aria-pressed="true"]').textContent()) || '').trim() === 'source');

      await page.locator('.paneswitch button', { hasText: 'preview' }).click();
      await page.waitForTimeout(300);
      ok('the switcher brings up the preview', (await visibleCols()).join(',') === 'preview',
        (await visibleCols()).join(','));
      ok('the phone still shows a real page, not a placeholder',
        await page.locator('.col-preview iframe').count() === 1);

      await page.locator('.paneswitch button', { hasText: 'tools' }).click();
      await page.waitForTimeout(250);
      await pickTab('console');
      ok('the tools pane still reaches a panel on a phone',
        await page.locator('.console').isVisible());
      ok('tools stay on the phone layout after opening a panel', (await sideways()) <= 1,
        `${await sideways()}px over`);

      /* Back to the desktop viewport so the closing assertions read normally. */
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.waitForTimeout(300);

      group('nothing errored');
      ok('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
      ok('no 4xx or 5xx responses', bad4xx.length === 0, bad4xx.slice(0, 4).join(' | '));
    } finally {
      await browser.close();
    }
  });
}, { OLLAMA_BASE_URL: fake.baseUrl, OLLAMA_MODEL: 'fake-model' });
await fake.close();

report('UI');