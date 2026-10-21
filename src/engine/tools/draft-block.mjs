#!/usr/bin/env node
/**
 * draft-block.mjs — ask a model for ONE page, then check what came back.
 *
 *   node src/engine/tools/draft-block.mjs books/my-book --topic "How a CDN works"
 *
 * Prints the page to stdout. Never writes into your interior file: a draft is a
 * draft, and it goes in the book after a person has read it. Use --out to save
 * it somewhere for review.
 *
 * The two rules that shape this file:
 *
 *   1. A model will happily invent a plausible number, and a plausible wrong
 *      number in a printed book is the worst thing this engine can produce. So
 *      the model is told to write [FACT NEEDED: ...] instead of guessing, and
 *      every draft is validated before it is handed over.
 *
 *   2. A page that breaks the engine's rules is worse than no page. So the draft
 *      is checked against the real contract below, and violations are reported
 *      as errors even though the draft is still printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve as resolveProvider, complete } from './llm.mjs';
import { makeStore, provenance } from './gen-ledger.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..', '..');

/* ---------------------------------------------------------------- archetypes */

const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', 'defaults.json'), 'utf8'));

/** The shapes, from the one registry the builder also reads. A shape that is
 *  documented in a README but missing here is a shape the drafter cannot use,
 *  so this file has no second copy of the list. */
export const ARCHETYPES = Object.fromEntries(
  Object.entries(DEFAULTS.archetypes).filter(([id]) => !id.startsWith('$')));

/** Refuse an archetype we do not have, the same way build-book refuses an unknown
 *  trim: quietly falling back to standard would hand the reader a page of the
 *  wrong shape and call it the shape they asked for. */
export function resolveArchetype(id) {
  const key = id || DEFAULTS.archetype;
  const found = ARCHETYPES[key];
  if (!found) {
    throw new Error(
      `unknown archetype "${id}". Known: ${Object.keys(ARCHETYPES).join(', ')}`);
  }
  return { id: key, ...found };
}

/* ------------------------------------------------------------------ contract */

/** The shape a page must have. Kept here, next to the validator that checks it. */
export const PAGE_CONTRACT = `A page is exactly one of these, in this order:

  <section class="sheet bb">
    <h2 class="sr">ONE real sentence describing this page, for screen readers and search</h2>
    <div class="tab"></div>
    <div class="top">
      <div class="eyebrow"><b>SERIES</b> PART - No. NN</div>
      <span class="pill">CATEGORY</span>
    </div>
    <h1 class="title">THE TITLE</h1>
    <div class="sub">one line, lowercase-ish, a gloss on the title</div>
    <hr class="rule">
    <div class="diagram">INLINE SVG</div>
    <hr class="rule">
    <div class="explain">
      <p>two or three short paragraphs. short sentences. no bullet lists.</p>
      <p class="close">the one line that lands it.</p>
    </div>
    <div class="foot"><span class="brand">BRAND</span><span class="pg"></span><span class="series">SERIES</span></div>
  </section>

  No <h2> other than the .sr one. No nested <section>. No <div class="ask"> / TELL THE
  AI box — that furniture is not part of a generated page. Nothing else.`;

/** The non-negotiables, phrased as rules a model can actually follow.
 *
 *  `content` is the one rule that moves with the archetype. Prose-only is right
 *  for a concept page and wrong for a procedure or an entry, so the archetype
 *  decides it — but only ever to widen it to lists and tables the validator then
 *  checks. The engine's own rule is that nothing here may change the page box. */
export function pageRules({ lists = false, table = false } = {}) {
  const proseRule = !lists && !table
    ? '7. The .explain paragraphs are plain prose. No <ul>, no <ol>, no <table>, no <h3>.'
    : table
      ? '7. The .explain may contain a <ul>, an <ol> or a <table class="ref">, because this\n   page shape calls for one. Everything else in .explain is still plain prose, and there\n   is still no <h3>. Use the table only for fields worth comparing side by side.'
      : '7. The .explain may contain a <ul> or an <ol>, because this page shape calls for one.\n   Everything else in .explain is still plain prose, and there is still no <h3>,\n   no <table> and no <div>.';

  return `Hard rules. Breaking any of these makes the page wrong:

1. ONE concept per page. If the topic needs two pages, write the first page only.
2. The diagram is INLINE SVG. Never a generated image, never a <img>, never a base64 blob.
   Photos are only for physical things you can photograph. A diagram is not a photo.
3. Every <text> inside the <svg> must set fill: explicitly, like
   style="font-family:'Inter',sans-serif;font-size:12px;fill:#1A1A2E". If it does not, it
   can inherit its way to invisible on paper.
4. Colour is a role, not a decoration:
     indigo  #6366F1  the mechanism, the thing that does the work
     teal    #0D9488  the good outcome
     red     #DC2626  the threat, or the mistake
     amber   #B45309  the thing being protected
     neutral #5B6472  the reader
5. NEVER shrink the viewBox to make it fit. A clipped diagram is a broken diagram.
   If it does not fit, use fewer words in the explainer.
6. DO NOT INVENT ANYTHING. Not a number, not a version, a date, a percentage, a company,
   a CVE, a quote or an anecdote. If you need one and do not know it, write
   [FACT NEEDED: what is missing] in the sentence and carry on. A visible gap is fine.
   A confident invention is not.
${proseRule}
8. Do not write <script>, <style>, @media print, or any CSS. The engine owns all layout.
9. Do not write a <div class="ask"> or a "TELL THE AI" box. That furniture is not part
   of a generated page, and a sentence that instructs the reader is not book text.
10. Do not write an instruction to a model, a question to the reader, or a meta note
    ("ask your assistant...", "write me a list...") anywhere on the page. The page is
    prose for a reader, in the book's voice.
11. The eyebrow's "No. NN" is a placeholder the engine numbers itself. Write it exactly
    as "No. NN" (or omit the number). It is NOT a fact to look up — never write
    "[FACT NEEDED: page number]".
12. Do not use markdown. Output raw HTML for the <section> and nothing else.`;
}

/** Kept as a module-level export so the existing tests and anyone reading this
 *  file can see the standard shape without asking for an archetype first. */
export const PAGE_RULES = pageRules();

/* ------------------------------------------------------------------ context */

/** The page titles already in the book, so the model does not repeat one. */
function existingTitles(html) {
  const out = [];
  const re = /<h1 class="title"[^>]*>([\s\S]*?)<\/h1>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1].replace(/\s+/g, ' ').trim());
  return out;
}

/** Read the book so the draft matches its actual voice and furniture. */
export function readBook(bookDir) {
  const dir = path.resolve(bookDir);
  if (!fs.existsSync(dir)) throw new Error(`No such book folder: ${bookDir}`);
  const jsonPath = path.join(dir, 'book.json');
  if (!fs.existsSync(jsonPath)) throw new Error(`No book.json in ${bookDir}.`);

  const book = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const interiorPath = path.join(dir, book.interior || `${path.basename(dir)}.html`);
  if (!fs.existsSync(interiorPath)) throw new Error(`No interior file at ${interiorPath}.`);

  const voicePath = path.join(dir, 'VOICE.md');
  return {
    dir,
    book,
    interior: fs.readFileSync(interiorPath, 'utf8'),
    voice: fs.existsSync(voicePath) ? fs.readFileSync(voicePath, 'utf8') : '(no VOICE.md yet)',
    interiorPath,
  };
}

/* ------------------------------------------------------------------ prompting */

export function buildPrompt({ ctx, topic, part, archetype }) {
  const { book } = ctx;
  const titles = existingTitles(ctx.interior);
  const partName = part || (book.parts?.[0]?.name ?? 'the first part');
  const arch = resolveArchetype(archetype ?? book.archetype ?? undefined);

  const shapeBlock = arch.shape
    ? `\nTHE SHAPE OF THIS PAGE: ${arch.label.toUpperCase()}\n\nThis page is a ${arch.label.toLowerCase()}: ${arch.note}. ${arch.shape}\n`
    : '';

  return `You are writing ONE page for a printed book. You are not writing a chapter.

THE BOOK
  title    ${book.title}
  series   ${book.series ?? book.title}
  brand    ${book.brand ?? ''}
  part     ${partName}
  category ${book.category ?? 'General'}

THE VOICE OF THIS BOOK (this is the most important input. Obey it over your own habits)
${ctx.voice}

${(book.tone || book.arc || book.thesis) ? `THE SHAPE OF THIS BOOK
${book.tone ? `  tone    ${book.tone}\n` : ''}${book.arc ? `  arc     ${book.arc}\n` : ''}${book.thesis ? `  thesis  ${book.thesis}\n` : ''}` : ''}HOW NOT TO SOUND LIKE A MACHINE

A reader hears "a robot wrote this" from a handful of tells. Do none of them:
  - No em dashes. Use a comma or a full stop. This is the loudest tell of all.
  - Use contractions: it's, you're, don't, isn't. Stripping them reads as machine text.
  - Never these words: delve, leverage, utilise/utilize, seamless, robust, game-changer,
    unlock, journey, tapestry, "in today's world", "it's worth noting", "in conclusion".
  - No "not only ... but also". No hedge stacks ("it could perhaps be argued").
  - Uneven rhythm: follow a long sentence with a very short one. Never three sentences
    of about the same length in a row.
  - Never start two sentences in a row with the same word.
  - Build the page from ONE concrete thing (a real address, a real command, a real
    object), never from abstractions.

${book.lang ? `THE LANGUAGE OF THIS BOOK
  The book is written in: ${book.lang}${book.dir ? ` (${book.dir})` : ''}.
  Write every word of the prose AND every label inside the SVG in that language.
  Do not translate the engine's own tokens: keep [FACT NEEDED: ...] and the eyebrow
  "No. NN" exactly as written. Proper nouns, code, identifiers, versions and numbers
  stay exactly as they are — a fact does not change language.

` : ''}THE PAGE
  topic: ${topic}

${titles.length ? `PAGES ALREADY IN THIS BOOK. Do not repeat any of them.\n${titles.map((t) => `  - ${t}`).join('\n')}\n` : ''}
THE SHAPE OF A PAGE

${PAGE_CONTRACT.replace(/SERIES/g, book.series ?? book.title).replace(/BRAND/g, book.brand ?? '').replace(/PART/g, partName).replace(/CATEGORY/g, book.category ?? 'General')}${shapeBlock}
THE RULES

${pageRules(arch.content)}

Write the page now. Raw HTML for the <section>, nothing before or after it.`;
}

/* ------------------------------------------------------------------ cleaning */

/** Models like to wrap HTML in a fence or add a sentence of preamble. Take the
 *  section out and leave everything else behind.
 *
 *  HTML comments are stripped first, and that is not cosmetic: a book's interior
 *  file mentions "<section class=\"sheet bb\">" inside a comment explaining the
 *  markup. Searching the raw text finds that mention first and returns a
 *  fragment spanning the comment, the <head>, and the page. */
export function extractSection(text) {
  let s = String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('<section');
  if (start === -1) return '';
  /* The FIRST close tag, not the last. A page contract forbids a nested
     <section>, so the first </section> after the opening one ends it. Reaching
     for the last one returns everything from the first page to the last, which on
     a ten-page file is the whole book: the caller then believes it was handed
     one page and writes ten. */
  const end = s.indexOf('</section>', start);
  if (end === -1) return '';
  s = s.slice(start, end + '</section>'.length);
  /* Tidy, do not reformat: re-indenting can break the SVG's whitespace text. */
  return s.replace(/^\s*\n/, '').trim();
}

/** How many pages the model actually sent. A draft is one page, so anything
 *  above one is worth saying out loud rather than silently discarding. */
export function countSections(text) {
  return (String(text || '').replace(/<!--[\s\S]*?-->/g, '')
    .match(/<section\b/g) || []).length;
}

/* ------------------------------------------------------------------ validation */

/** Pull a numeric attribute off a tag, whether it was quoted or not. */
function attr(tag, name) {
  const q = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  if (q) return q[1].trim();
  const u = tag.match(new RegExp(`\\b${name}\\s*=\\s*([-\\d.]+)`));
  return u ? u[1] : null;
}

const num = (v) => (v === null || v === '' ? NaN : Number(v));
const ROLE_WORDS = new Set(['mechanism', 'good outcome', 'bad outcome', 'threat', 'indigo', 'teal', 'amber', 'neutral', 'the mechanism']);

/**
 * Structural lint for the inline diagram. check.mjs cannot see any of this: it
 * only measures overflow and broken <img>. A malformed attribute, a label drawn
 * outside the viewBox, or a diagram that is three words and no drawing all reach
 * the printed page looking broken.
 */
export function checkDiagram(section) {
  const errors = [];
  const warnings = [];
  const start = section.indexOf('<svg');
  if (start === -1) return { errors, warnings };
  const end = section.indexOf('</svg>', start);
  const svg = section.slice(start, end === -1 ? undefined : end + 6);

  const vb = svg.match(/viewBox\s*=\s*"([^"]*)"/);
  let w = NaN;
  let h = NaN;
  if (!vb) {
    errors.push('the <svg> has no viewBox. Without one it cannot scale and will clip.');
  } else {
    const parts = vb[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      errors.push(`the viewBox "${vb[1]}" is not four numbers.`);
    } else {
      [, , w, h] = parts;
    }
  }

  /* The exact bug that reached a book: height=100fill="#..." — a value glued to
     the next attribute because a space (or quote) is missing. */
  const glued = svg.match(/=[\s]?[0-9][^"\s>]*[A-Za-z]/);
  if (glued) {
    errors.push(`malformed SVG attribute "${glued[0].trim()}" — a value is missing its space or quote.`);
  }

  if (!/<(rect|circle|ellipse|line|polygon|polyline|path)\b/.test(svg)) {
    errors.push('the diagram has no shapes — only text. A diagram needs a drawing, not a caption.');
  }

  /* Nothing may be drawn (or labelled) outside the viewBox. */
  if (Number.isFinite(w) && Number.isFinite(h)) {
    const out = [];
    for (const tag of svg.match(/<rect\b[^>]*>/g) || []) {
      const x = num(attr(tag, 'x')) || 0;
      const y = num(attr(tag, 'y')) || 0;
      const rw = num(attr(tag, 'width')) || 0;
      const rh = num(attr(tag, 'height')) || 0;
      if (x < 0 || y < 0 || x + rw > w + 1 || y + rh > h + 1) out.push(`rect at ${x},${y} ${rw}x${rh}`);
    }
    for (const tag of svg.match(/<text\b[^>]*>/g) || []) {
      const x = num(attr(tag, 'x'));
      const y = num(attr(tag, 'y'));
      if (x < -1 || x > w + 1 || y < -1 || y > h + 1) out.push(`text at ${x},${y}`);
    }
    for (const tag of svg.match(/<line\b[^>]*>/g) || []) {
      for (const [ax, ay] of [['x1', 'y1'], ['x2', 'y2']]) {
        const x = num(attr(tag, ax));
        const y = num(attr(tag, ay));
        if (x < -1 || x > w + 1 || y < -1 || y > h + 1) out.push(`line point ${x},${y}`);
      }
    }
    if (out.length) {
      errors.push(`the diagram draws outside its ${w}x${h} viewBox: ${out.slice(0, 3).join('; ')}.`);
    }
  }

  /* A label that is the palette's own vocabulary means the model drew the rule,
     not the idea. Warn — it is ugly, not fatal. */
  for (const m of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const label = m[1].replace(/<[^>]*>/g, '').trim().toLowerCase();
    if (ROLE_WORDS.has(label)) {
      warnings.push(`the diagram labels a box "${label}" — that is a colour role, not a concept.`);
      break;
    }
  }

  return { errors, warnings };
}

/**
 * Check a draft against the contract. Returns {errors, warnings, gaps}.
 * `gaps` are the [FACT NEEDED] markers: not an error, but the reader must see
 * them, because each one is a sentence the book does not have yet.
 */
export function validate(section, archetype) {
  const errors = [];
  const warnings = [];
  const s = section;
  /* An unknown name must be as loud here as it is in the prompt: validating
     against a shape that does not exist would silently check the wrong rules. */
  let arch = null;
  try { arch = archetype ? resolveArchetype(archetype) : resolveArchetype(); }
  catch (e) { errors.push(e.message); }
  const content = arch?.content ?? { lists: false, table: false };

  const nSections = (s.match(/<section/g) || []).length;
  if (nSections !== 1) errors.push(`expected exactly 1 <section>, found ${nSections}`);

  for (const [cls, what] of [
    ['sr', 'the screen-reader <h2 class="sr"> sentence'],
    ['title', 'an <h1 class="title">'],
    ['sub', 'a <div class="sub">'],
    ['diagram', 'a <div class="diagram">'],
    ['explain', 'a <div class="explain">'],
    ['foot', 'a <div class="foot">'],
  ]) {
    if (!new RegExp(`class="${cls}"`).test(s) && !new RegExp(`class="[^"]*\\b${cls}\\b`).test(s)) {
      errors.push(`missing ${what}`);
    }
  }
  if (/class="[^"]*\bask\b/.test(s)) {
    errors.push('contains a <div class="ask"> / TELL THE AI box. A generated page is prose only.');
  }

  if (!/<svg[\s>]/.test(s)) errors.push('no <svg>. The diagram is inline SVG, not an image.');
  if (/<img\b/i.test(s)) errors.push('contains <img>. Diagrams are inline SVG; only real photos may be images.');
  const dia = checkDiagram(s);
  errors.push(...dia.errors);
  warnings.push(...dia.warnings);
  if (/<(script|style)\b/i.test(s)) errors.push('contains <script> or <style>. The engine owns layout.');
  if (/@media\s+print/i.test(s)) errors.push('contains an @media print rule. Never, for any reason.');
  if (/on[a-z]+\s*=\s*["']/i.test(s)) warnings.push('contains an inline event handler, e.g. onclick.');

  /* The rule that is easiest to break and hardest to notice on screen. */
  const texts = s.match(/<text\b[^>]*>/g) || [];
  const noFill = texts.filter((t) => !/fill\s*:/.test(t));
  if (noFill.length) {
    errors.push(
      `${noFill.length} <text> element(s) have no explicit fill. On paper they may be invisible.`
    );
  }

  /* The .sr line doubles as the accessibility text, so a placeholder there is
     worse than anywhere else. */
  const sr = s.match(/<h2 class="sr">([\s\S]*?)<\/h2>/);
  if (sr && /^(this page|an explainer|the author)/i.test(sr[1].trim())) {
    warnings.push('the .sr sentence starts like filler. Write a real sentence about the idea.');
  }

  const gaps = [...s.matchAll(/\[FACT NEEDED:\s*([^\]]+)\]/g)]
    .map((m) => m[1].trim())
    /* The eyebrow's page number is the engine's to fill, not a fact to source,
       so a placeholder there is not a gap the reader has to close. */
    .filter((g) => !/page number/i.test(g));

  /* Colour is a role. Check the roles actually appear rather than guess. */
  const inks = s.match(/(?:#[0-9A-Fa-f]{6}|red|teal|indigo|amber)/g) || [];
  if (inks.length < 3) warnings.push('the diagram uses very few colours. Is it readable in one ink?');

  /* Lists and tables are only ever a page SHAPE's decision, never a model's.
     Check them inside .explain only, because an <ol> in a diagram would be a
     different kind of mistake and is already caught by the <h3>-free rule above. */
  if (arch) {
    const explain = s.match(/<div class="explain">([\s\S]*?)<\/div>/)?.[1] ?? '';
    const listTags = [...explain.matchAll(/<(ol|ul)\b/gi)].map((m) => m[1].toLowerCase());
    if (listTags.length && !content.lists) {
      errors.push(
        `the "${arch.id}" shape is prose only, but the explainer contains <${[...new Set(listTags)].join('>, <')}>. `
        + 'Either drop the list or draft the page as procedure, recipe, exercise or reference.');
    }
    if (/<table\b/i.test(explain) && !content.table) {
      errors.push(
        `the "${arch.id}" shape cannot hold a table. Only the reference shape has tables.`);
    }
    /* The theme hooks off this attribute, so if the model invents its own value
       the page renders unstyled and nothing will say why. */
    const claimed = s.match(/<section[^>]*\bdata-archetype="([^"]+)"/)?.[1];
    if (claimed !== undefined && !Object.hasOwn(ARCHETYPES, claimed)) {
      errors.push(`data-archetype="${claimed}" is not a known archetype. Known: ${Object.keys(ARCHETYPES).join(', ')}`);
    }
    if (arch.dataAttribute && claimed === undefined) {
      warnings.push(
        `no data-archetype="${arch.id}" on the <section>, so the theme cannot dress this page. `
        + 'Add it to the opening <section class="sheet bb">.');
    }
  }

  return { errors, warnings, gaps };
}

/* ------------------------------------------------------------------ draft */

/**
 * Draft one page. Returns {section, validation, meta} and never touches the book.
 * `fetchImpl` is injectable so callers can supply a stub.
 */
export async function draftBlock({
  bookDir,
  topic,
  part,
  archetype,
  provider,
  model,
  allowPaid = false,
  seed = null,
  replay = false,
  ledger = false,
  cache = null,
  signal,
  fetchImpl = fetch,
  env = process.env,
}) {
  if (!topic || !String(topic).trim()) throw new Error('A topic is required. --topic "..."');

  const ctx = readBook(bookDir);
  const r = resolveProvider({ provider, model, allowPaid, env });
  const arch = resolveArchetype(archetype ?? ctx.book.archetype ?? undefined);

  /* A ledger is opt-in: recording is a deliberate act, and an explicit `cache`
     (used by the tests) wins over making one. replay implies a ledger, because
     there is nothing to replay from otherwise. */
  const store = cache ?? ((ledger || replay || seed != null) ? makeStore(bookDir, { replay }) : null);

  const text = await complete(
    r,
    {
      system: pageRules(arch.content),
      user: buildPrompt({ ctx, topic, part, archetype: arch.id }),
      seed,
      cache: store,
      signal,
      fetchImpl,
    }
  );

  const section = extractSection(text);
  const validation = validate(section, arch.id);
  const extra = countSections(text) - 1;
  if (extra > 0) {
    validation.warnings.push(
      `the model sent ${extra + 1} pages. A draft is one page, so only the first was kept — `
      + 're-run it per topic if you want the rest.');
  }
  return {
    section,
    validation,
    provenance: store?.lastEntry ? provenance(store.lastEntry) : null,
    meta: {
      provider: r.id,
      label: r.label,
      model: r.model,
      cost: r.cost,
      archetype: arch.id,
      book: path.basename(ctx.dir),
      title: ctx.book.title,
      seed,
      requestKey: store?.last ?? null,
      replayed: store?.replayed ?? false,
      ledger: !!store,
    },
  };
}

/** Print the validation result the same way every time, so it can be scanned. */
export function reportValidation(v) {
  const lines = [];
  for (const e of v.errors) lines.push(`  ERROR   ${e}`);
  for (const w of v.warnings) lines.push(`  warn    ${w}`);
  if (v.gaps.length) {
    lines.push(`  ${v.gaps.length} fact(s) you must fill in yourself:`);
    for (const g of v.gaps) lines.push(`            [FACT NEEDED: ${g}]`);
  }
  if (!v.errors.length && !v.warnings.length && !v.gaps.length) lines.push('  clean');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ cli */

const USAGE = `Usage: node src/engine/tools/draft-block.mjs books/<slug> --topic "..." [options]

  --topic "..."      the one concept this page is about   (required)
  --part "..."       which part it belongs to            (default: the book's first part)
  --archetype "..."  standard | procedure | recipe | exercise | reference
  --provider <id>    ollama | lmstudio | gemini | openrouter | groq | github |
                     mistral | openai | anthropic | xai        (run llm.mjs --list)
  --model <id>       override the provider's default model
  --allow-paid       required before any paid provider is called
  --seed <n>         fix the seed (and record it) so the page repeats
  --ledger           record this generation in books/<slug>/.gen/ (provenance + cache)
  --replay           rebuild offline from the .gen cache; never call the model
  --out <file>       also write the draft to a file for review
  --validate-only <file>   check an existing draft, no model needed

Nothing is ever written into your book. Read it first.`;

async function main(argv) {
  const flag = (n) => {
    const i = argv.indexOf('--' + n);
    return i === -1 ? null : argv[i + 1];
  };

  const only = flag('validate-only');
  if (only) {
    const section = extractSection(fs.readFileSync(only, 'utf8'));
    const v = validate(section);
    console.log(reportValidation(v));
    process.exit(v.errors.length ? 2 : 0);
  }

  const bookDir = argv[0];
  if (!bookDir || argv.includes('--help')) {
    console.log(USAGE);
    process.exit(bookDir ? 0 : 1);
  }

  const seedArg = flag('seed');
  const result = await draftBlock({
    bookDir,
    topic: flag('topic'),
    part: flag('part'),
    archetype: flag('archetype'),
    provider: flag('provider'),
    model: flag('model'),
    allowPaid: argv.includes('--allow-paid'),
    seed: seedArg == null ? null : Number(seedArg),
    ledger: argv.includes('--ledger'),
    replay: argv.includes('--replay'),
  });

  console.log(`\n  ${result.meta.label} / ${result.meta.model}  ->  ${result.meta.book}`
    + (result.meta.replayed ? '  (replayed from the ledger)' : '') + '\n');
  console.log(result.section);
  console.log('\n  -- validation ------------------------------------');
  console.log(reportValidation(result.validation));
  if (result.provenance) console.log(`\n  ${result.provenance}`);

  const out = flag('out');
  if (out) {
    /* The provenance comment rides above the section so a page in a file always
       says how it was made. extractSection ignores it, so validate still works. */
    const header = result.provenance ? `<!-- ${result.provenance} -->\n` : '';
    fs.writeFileSync(out, header + result.section + '\n');
    console.log(`\n  written to ${out}`);
  }
  console.log(
    '\n  This is a draft. It is not in your book. Read it, then paste it into the\n' +
      '  interior file and add the title to book.json.\n'
  );

  process.exitCode = result.validation.errors.length ? 2 : 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  main(process.argv.slice(2)).catch((e) => {
    console.error('\n' + e.message + '\n');
    process.exit(1);
  });
}