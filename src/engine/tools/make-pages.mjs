#!/usr/bin/env node
/**
 * make-pages.mjs — a set of pages with no book around them.
 *
 *   node src/engine/tools/make-pages.mjs --topic "How a CDN works" --pages 3 --formats all
 *   node src/engine/tools/make-pages.mjs --source "the line or paragraph you want explained"
 *   node src/engine/tools/make-pages.mjs --from notes.md --pages 4 --out pages/cdn
 *
 * One concept per page, the same page contract and the same validation gate as a
 * book page — but no cover, no copyright, no contents, no part dividers and no
 * index. It writes pages/<slug>/pages.html plus whatever formats were asked for.
 *
 * The count is a request. A page the validator rejects, or one still holding a
 * [FACT NEEDED] gap, is skipped and named. Nothing is invented to reach the
 * number.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { draftBlock, pageContext } from './draft-block.mjs';
import { planPages, clampPages } from './plan-from-source.mjs';
import { intake } from './source-intake.mjs';
import { pageAcceptable, prepareSection } from './make-book.mjs';
import { inlineLocalAssets } from './lib/book-html.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(__dir, '..');
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ENGINE, 'defaults.json'), 'utf8'));

const ALL_FORMATS = ['html', 'png', 'pdf', 'md'];
const KNOWN_FORMATS = new Set(ALL_FORMATS);

export function normalizeFormats(formats) {
  const list = formats == null ? ['html']
    : Array.isArray(formats) ? formats
      : String(formats).split(',');
  const out = new Set();
  for (const raw of list) {
    const f = String(raw).trim().toLowerCase();
    if (!f) continue;
    if (f === 'all') { for (const a of ALL_FORMATS) out.add(a); continue; }
    if (!KNOWN_FORMATS.has(f)) throw new Error(`unknown format "${f}". Known: ${ALL_FORMATS.join(', ')}, all`);
    out.add(f);
  }
  out.add('html');
  return ALL_FORMATS.filter((f) => out.has(f));
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function onePageDocument({ title, size, theme, sections, dir }) {
  const sizeFile = DEFAULTS.sizes[size]?.file;
  const themeFile = DEFAULTS.themes[theme]?.file;
  if (!sizeFile) throw new Error(`unknown size "${size}". Known: ${Object.keys(DEFAULTS.sizes).join(', ')}`);
  if (!themeFile) throw new Error(`unknown theme "${theme}". Known: ${Object.keys(DEFAULTS.themes).join(', ')}`);

  const engineRel = path.relative(dir, ENGINE).replace(/\\/g, '/') || '.';
  const head = `<!doctype html>
<html lang="en" data-size="${size}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="${engineRel}/sheet.css">
  <link rel="stylesheet" href="${engineRel}/sizes/${sizeFile}">
  <link rel="stylesheet" href="${engineRel}/themes/${themeFile}">
</head>
<body>
  <main class="deck">
`;
  const tail = `
  </main>
  <script src="${engineRel}/sheet-tools.js"></script>
</body>
</html>
`;
  return head + sections.map((s) => '    ' + s).join('\n\n') + '\n' + tail;
}

/**
 * Plan N pages, draft them, and write a standalone page pack. Never builds a
 * book. `source` is text that has already been intaken.
 */
export async function makePages({
  slug = 'pages',
  source,
  topic = '',
  pages = 1,
  size = 'b5',
  theme = 'studio',
  archetype = 'standard',
  voice = '',
  title = null,
  outDir = null,
  formats = ['html'],
  provider,
  model,
  allowPaid = false,
  signal,
  env = process.env,
  fetchImpl,
  onPage,
}) {
  if (!source || !String(source).trim()) throw new Error('a source is required');

  /* The count is a whole number in 1..40. A caller that skips the server's
     check still gets a real page count, not NaN, not zero. */
  pages = clampPages(pages);

  const safe = String(slug || 'pages').toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '').slice(0, 64) || 'pages';
  const dir = path.resolve(outDir || path.join('pages', safe));
  const fmt = normalizeFormats(formats);

  const { plan, validation } = await planPages({
    source, topic, pages, archetype, voice,
    provider, model, allowPaid, signal, env, fetchImpl,
  });

  /* The caller's shape is a decision, not a suggestion: every page is drafted in
     it, whatever the planner wrote per entry. */
  const ctx = pageContext({
    title: title || plan.title || topic || 'Pages',
    voice, archetype,
    parts: [{ name: 'Pages', blocks: plan.pages.map((p) => p.title) }],
  });

  const written = [];
  for (const p of plan.pages) {
    try {
      const out = await draftBlock({
        context: ctx,
        topic: p.topic,
        part: 'Pages',
        archetype,
        provider, model, allowPaid, signal, env, fetchImpl,
      });
      const gate = pageAcceptable(out.validation);
      if (!out.section || !gate.ok) {
        const reason = !out.section ? 'no page returned' : gate.reason;
        written.push({ title: p.title, ok: false, reason });
        onPage?.({ title: p.title, ok: false, error: reason, index: written.length, total: plan.pages.length });
        continue;
      }
      let section = prepareSection(out.section, written.length + 1);
      if (archetype !== 'standard' && !/\bdata-archetype=/.test(section)) {
        section = section.replace(/<section\b([^>]*)>/, (m, attrs) => `<section${attrs} data-archetype="${archetype}">`);
      }
      written.push({ title: p.title, ok: true, section });
      onPage?.({ title: p.title, ok: true, index: written.length, total: plan.pages.length });
    } catch (e) {
      written.push({ title: p.title, ok: false, reason: e.message });
      onPage?.({ title: p.title, ok: false, error: e.message, index: written.length, total: plan.pages.length });
    }
  }

  const kept = written.filter((w) => w.ok);
  if (!kept.length) throw new Error('no page survived validation; nothing was written');

  /* The folder is only made once there is a page to put in it, so a run that
     writes nothing leaves no empty folder behind to trip the 409 next time. */
  fs.mkdirSync(dir, { recursive: true });

  const htmlPath = path.join(dir, 'pages.html');
  const built = onePageDocument({
    title: title || plan.title || topic || 'Pages',
    size, theme, dir,
    sections: kept.map((w) => w.section),
  });
  let doc = built;
  /* The page counter script is part of the page, so inline it too. With the
     stylesheets and images inlined the HTML is one file that opens anywhere. */
  const scriptPath = path.join(ENGINE, 'sheet-tools.js');
  if (fs.existsSync(scriptPath)) {
    doc = doc.replace(/<script src="[^"]*sheet-tools\.js"><\/script>/,
      () => `<script>\n${fs.readFileSync(scriptPath, 'utf8')}\n</script>`);
  }
  doc = inlineLocalAssets(doc, dir).html;
  fs.writeFileSync(htmlPath, doc);

  const result = {
    dir, htmlPath, pdfPath: null, pngs: [], mds: [],
    pages: written, count: kept.length, requested: pages, plan, validation, formats: fmt,
    failures: written.filter((w) => !w.ok),
  };

  if (fmt.includes('pdf')) {
    const pdfPath = path.join(dir, 'pages.pdf');
    try {
      execFileSync(process.execPath, [path.join(ENGINE, 'tools', 'export.mjs'), htmlPath, pdfPath], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      result.pdfPath = pdfPath;
    } catch (e) {
      result.pdfError = String(e.stderr || e.message);
    }
  }

  if (fmt.includes('png')) {
    try {
      execFileSync(process.execPath, [path.join(ENGINE, 'tools', 'shot.mjs'), htmlPath, dir], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      for (let i = 1; i <= kept.length; i++) {
        const p = path.join(dir, `page${i}.png`);
        if (fs.existsSync(p)) result.pngs.push(p);
      }
    } catch (e) {
      result.pngError = String(e.stderr || e.message);
    }
  }

  if (fmt.includes('md')) {
    for (let i = 1; i <= kept.length; i++) {
      const out = path.join(dir, `page${i}.md`);
      try {
        execFileSync(process.execPath, [
          path.join(ENGINE, 'tools', 'export-card.mjs'), htmlPath,
          '--page', String(i), '--format', 'md', '--out', out,
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        if (fs.existsSync(out)) result.mds.push(out);
      } catch (e) {
        result.mdError = String(e.stderr || e.message);
      }
    }
  }

  return result;
}

/* ------------------------------------------------------------------ cli */

const USAGE = `Usage: node src/engine/tools/make-pages.mjs --topic "..." [options]

  --topic "..."        what the pages are about
  --source "..."       a line or paragraph to explain, verbatim
  --from <file>        read the source from a text/markdown file
  --pages <n>          how many pages to make (1-40, default 1)
  --size <id>          b5 | b5-landscape | a5 | a4 | six-by-nine   (default b5)
  --theme <id>         studio | cookbook | manual | reference      (default studio)
  --archetype <id>     standard | procedure | recipe | exercise | reference
  --voice <file>       a VOICE.md to write in
  --slug <name>        output folder name (default: from the title)
  --out <dir>          exact output folder (default pages/<slug>)
  --formats <list>     html,png,pdf,md or all                    (default html)
  --provider <id>      a provider from llm.mjs --list
  --model <id>         override the provider's default model
  --allow-paid         required before any paid provider is called

No book is created. The pages.html is standalone: CSS and images are inlined.`;

async function main(argv) {
  const flag = (n) => {
    const i = argv.indexOf('--' + n);
    return i === -1 ? null : argv[i + 1];
  };
  if (!argv.length || argv.includes('--help')) { console.log(USAGE); process.exit(argv.length ? 0 : 1); }

  const from = flag('from');
  const rawSource = flag('source');
  const topic = flag('topic') || '';
  const text = from ? fs.readFileSync(from, 'utf8') : (rawSource || topic);
  if (!text) { console.error('one of --topic, --source or --from is required'); process.exit(1); }

  const voiceFile = flag('voice');
  const voice = voiceFile ? fs.readFileSync(voiceFile, 'utf8') : '';
  const sourceType = rawSource ? 'text' : 'topic';
  const src = await intake({ type: sourceType, value: text });

  const r = await makePages({
    slug: flag('slug') || undefined,
    source: src.text,
    topic,
    pages: Number(flag('pages') || 1),
    size: flag('size') || 'b5',
    theme: flag('theme') || 'studio',
    archetype: flag('archetype') || 'standard',
    voice,
    outDir: flag('out') || null,
    formats: flag('formats') || 'html',
    provider: flag('provider'),
    model: flag('model'),
    allowPaid: argv.includes('--allow-paid'),
    onPage: (p) => console.log(`  page ${p.index}/${p.total}: ${p.title}${p.ok ? '' : ` — ${p.error}`}`),
  });

  const rel = path.relative(process.cwd(), r.htmlPath).replace(/\\/g, '/');
  console.log(`\nwrote ${r.count} page(s) to ${path.dirname(rel)} (asked for ${r.requested})`);
  console.log(`  ${rel}`);
  if (r.pdfPath) console.log(`  ${path.relative(process.cwd(), r.pdfPath).replace(/\\/g, '/')}`);
  for (const p of r.pngs) console.log(`  ${path.relative(process.cwd(), p).replace(/\\/g, '/')}`);
  for (const p of r.mds) console.log(`  ${path.relative(process.cwd(), p).replace(/\\/g, '/')}`);
  for (const f of r.failures) console.log(`  skipped "${f.title}": ${f.reason}`);
  if (r.pdfError) console.error(`  pdf failed: ${r.pdfError}`);
  if (r.pngError) console.error(`  png failed: ${r.pngError}`);
  if (r.mdError) console.error(`  md failed: ${r.mdError}`);
  process.exitCode = r.failures.length ? 2 : 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  main(process.argv.slice(2)).catch((e) => {
    console.error('\n' + e.message + '\n');
    process.exit(1);
  });
}
