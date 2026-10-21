#!/usr/bin/env node
/**
 * make-book.mjs — walk a validated plan and draft one page per block.
 *
 *   node src/engine/tools/make-book.mjs books/<slug> --plan plan.json --provider ollama
 *
 * Every page goes through the normal drafting path (draft-block.mjs), so it gets
 * the same fact rules, the same archetype shape, and the same contract check.
 * Pages that the model failed to produce are skipped and reported, not silently
 * dropped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { draftBlock } from './draft-block.mjs';
import { templateById } from './templates.mjs';

/** Final, engine-owned cleanup before a validated page is written.
 *
 *  Even a page that passed the validator can still carry furniture that is not
 *  ours to print: a "TELL THE AI" ask box, or the eyebrow's page-number
 *  placeholder the model treated as a fact. Both are removed here, by the engine,
 *  so the book never shows them.
 */
/** Whether a validated draft is allowed into the book, and why not if it is not.
 *  A page with a rule error or an unfilled [FACT NEEDED] gap is skipped, not
 *  written: that is the whole gate. */
export function pageAcceptable(v) {
  if (!v) return { ok: false, reason: 'no page returned' };
  if (v.errors.length) return { ok: false, reason: `${v.errors.length} rule error(s): ${v.errors[0]}` };
  if (v.gaps.length) return { ok: false, reason: `${v.gaps.length} unfilled fact(s): ${v.gaps[0]}` };
  return { ok: true, reason: '' };
}

export function prepareSection(section, pageNumber) {
  let s = String(section);
  /* Drop any ask / TELL THE AI box: it has no nested <div>, so the first close
     tag ends it. */
  s = s.replace(/\s*<div class="ask">[\s\S]*?<\/div>/g, '');
  /* Fill the page number the engine owns, whatever placeholder the model left. */
  const nn = String(pageNumber).padStart(2, '0');
  s = s.replace(/No\.\s*\[FACT NEEDED:[^\]]*page number[^\]]*\]/gi, `No. ${nn}`);
  s = s.replace(/No\.\s*NN\b/g, `No. ${nn}`);
  return s;
}

/** Copies the chosen template's scaffold, writes book.json from the plan,
 *  drafts every planned block, and finally builds. Never invents a page title.
 *  `templateId` names a scaffold in templates.mjs; the default is books/starter. */
export async function makeBook({ slug, plan, theme = null, size = null, bookRoot = 'books',
  templateId = 'starter',
  lang = null, direction = null, fonts = null,
  provider, model, allowPaid = false, signal, env, onPage }) {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(slug)) {
    throw new Error(`bad slug "${slug}". lowercase letters, digits, dashes, dots, underscores.`);
  }
  const dir = path.join(bookRoot, slug);
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`);

  const tpl = templateId && templateId !== 'starter' ? templateById(templateId) : null;
  const srcDir = tpl ? tpl.dir : path.join(bookRoot, 'starter');
  if (!fs.existsSync(srcDir)) throw new Error(`template "${templateId || 'starter'}" is missing at ${srcDir}`);
  theme = theme || tpl?.theme || 'studio';
  size = size || tpl?.size || 'b5';

  fs.cpSync(srcDir, dir, { recursive: true });
  const srcCfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(srcDir, 'book.json'), 'utf8')); } catch { return {}; } })();
  const interiorName = srcCfg.interior || `${templateId || 'starter'}.html`;
  const staleInterior = path.join(dir, interiorName);
  if (interiorName !== `${slug}.html` && fs.existsSync(staleInterior)) {
    fs.renameSync(staleInterior, path.join(dir, `${slug}.html`));
  }
  for (const f of ['book.html', 'book.pdf', 'book-free.html', 'book-free.pdf']) {
    fs.rmSync(path.join(dir, f), { force: true });
  }

  /* Clean interior: the head is the template's own (proven by check.mjs on every
     book that exists), and the body is emptied of pages so we are the only hand
     on it. Any example pages the template ships are dropped, not kept. */
  const scaffoldHtml = fs.readFileSync(path.join(dir, `${slug}.html`), 'utf8');
  const head = scaffoldHtml.slice(0, scaffoldHtml.indexOf('<body>'));
  const themeFile = theme.endsWith('.css') ? theme : `${theme}.css`;
  const headThemed = head.replace(/themes\/[a-z-]+\.css/, `themes/${themeFile}`);
  const interiorPath = path.join(dir, `${slug}.html`);
  fs.writeFileSync(interiorPath,
    `${headThemed}<body>\n  <main class="deck">\n\n  </main>\n</body>\n</html>\n`);

  const bookJson = {
    title: plan.title,
    subtitle: plan.subtitle,
    author: '(add your name)',
    series: plan.title,
    brand: 'yoursite.com',
    editionLabel: 'Edition 1.0',
    unit: 'pages',
    numbered: true,
    contents: true,
    index: true,
    theme,
    size,
    ...(lang ? { lang } : {}),
    ...(direction ? { dir: direction } : {}),
    ...(fonts && fonts.length ? { fonts: Array.isArray(fonts) ? fonts : [...fonts] } : {}),
    cover: { kicker: 'A Proofpress book', note: plan.thesis },
    copyright: { year: new Date().getFullYear(), rights: 'All rights reserved.', lines: [] },
    parts: plan.parts.map((p) => ({
      name: p.name,
      eyebrow: p.eyebrow || '',
      why: p.why || '',
      blocks: p.blocks.map((b) => b.title),
    })),
    editions: {},
  };
  fs.writeFileSync(path.join(dir, 'book.json'), JSON.stringify(bookJson, null, 2) + '\n');

  const blocks = plan.parts.flatMap((p) => p.blocks.map((b) => ({ ...b, partName: p.name })));
  const pages = [];
  for (const b of blocks) {
    try {
      const out = await draftBlock({
        bookDir: dir,
        topic: b.topic,
        part: b.partName,
        archetype: b.archetype,
        provider, model, allowPaid, signal, env,
      });
      const v = out.validation;
      /* The gate. A page the validator flagged, or one still holding a
         [FACT NEEDED] gap, is not written into the book — it is skipped and
         named. The old behaviour wrote it anyway, which is how a malformed
         diagram and a literal "[FACT NEEDED: page number]" reached a page. */
      const gate = pageAcceptable(v);
      const clean = Boolean(out.section) && gate.ok;
      if (!clean) {
        const reason = !out.section ? 'no page returned' : gate.reason;
        pages.push({ title: b.title, ok: false, reason });
        onPage?.({ title: b.title, ok: false, error: reason, index: pages.length, total: blocks.length });
        continue;
      }
      const section = prepareSection(out.section, pages.length + 1);
      fs.writeFileSync(interiorPath,
        fs.readFileSync(interiorPath, 'utf8').replace('</main>', `    ${section}\n\n  </main>`));
      pages.push({ title: b.title, ok: true, issues: 0, gaps: 0 });
      onPage?.({ title: b.title, ok: true, index: pages.length, total: blocks.length });
    } catch (e) {
      pages.push({ title: b.title, ok: false, reason: e.message });
      onPage?.({ title: b.title, ok: false, error: e.message, index: pages.length, total: blocks.length });
    }
  }

  let buildCode = 0;
  let buildTail;
  try {
    const out = execFileSync(process.execPath, [path.join('src', 'engine', 'tools', 'build-book.mjs'), dir], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    buildTail = out;
  } catch (e) {
    buildCode = e.status ?? 1;
    buildTail = String(e.stderr || e.message);
  }
  return { dir, pages, buildCode, buildTail };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const [, , planArg, slugArg] = process.argv;
  const plan = JSON.parse(fs.readFileSync(planArg, 'utf8'));
  makeBook({ slug: slugArg, plan, provider: process.env.LLM_PROVIDER || 'ollama' })
    .then((r) => { console.log(`pages ok: ${r.pages.filter((p) => p.ok).length}/${r.pages.length}`); process.exit(r.buildCode); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}