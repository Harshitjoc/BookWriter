#!/usr/bin/env node
/**
 * plan-from-source.mjs — one LLM call that turns source text into a book plan.
 *
 *   node src/engine/tools/plan-from-source.mjs --source <text> --voice <text>
 *                                          --provider ollama --topic "..."
 *
 * Returns a validated plan object. Everything downstream (title, parts, the
 * per-page topics and shapes) comes from this one call. The work of writing the
 * pages is still done by draft-block.mjs, so every page passes the existing
 * validation gate.
 */
import { resolve as resolveProvider, complete } from './llm.mjs';

export const PLAN_SYSTEM = `You are the planning editor of a small-press book engine.

You are handed reading material and you must turn it into a concrete, page-by-page
plan for either:
  - a focused little book (one concept per page), or
  - a long-form research paper.

Output ONE valid JSON object. Nothing before it. Nothing after it. No fences.

Every page must declare its archetype:
  - "standard"    plain concept explainer, prose only
  - "procedure"   numbered steps to follow
  - "recipe"      what goes in, then how, then notes
  - "exercise"    a task with a stated goal and a check
  - "reference"   a lookup entry. The only one that may hold a table

Never invent facts, numbers, versions, dates, company names, quotes, or anecdotes.
If the source does not support a claim, do not put it in the plan.

JSON shape:
{
  "title": "...",
  "subtitle": "...",
  "thesis": "one sentence about what this book actually teaches",
  "parts": [
    { "name": "Part name", "eyebrow": "short", "why": "one line",
      "blocks": [
        { "title": "the page's concept", "archetype": "standard", "topic": "one line brief for that page" }
      ] }
  ],
  "pageCountHint": 10
}

Rules:
- 2 to 5 parts, 3 to 20 pages in total.
- Archetype "standard" must never list a list/table; "reference" should exist in
  a book only if there is genuine lookup material.
- Each "title" is unique within the plan: it is how pages are addressed.
- Output JSON only.`.trim();

/* What a person can ask for, and what the engine will accept. A count is a
   request, not a promise: the planner is told the target and a mismatch is
   reported, never padded with invented pages. */
export const PLAN_MIN_PAGES = 1;
export const PLAN_MAX_PAGES = 40;

export function clampPages(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < PLAN_MIN_PAGES) return PLAN_MIN_PAGES;
  return Math.min(PLAN_MAX_PAGES, v);
}

export function extractJson(text) {
  /* A model that wraps its JSON in a fence or preamble is common. Take the first
     balanced object out, then JSON.parse it. Nothing else counts. */
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

export function validatePlan(plan, { pages = null } = {}) {
  const errors = [];
  const warnings = [];
  const ARCH = new Set(['standard', 'procedure', 'recipe', 'exercise', 'reference']);

  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['not an object'], warnings: [] };
  if (!plan.title || typeof plan.title !== 'string') errors.push('missing title');
  if (!plan.subtitle || typeof plan.subtitle !== 'string') errors.push('missing subtitle');
  if (!plan.thesis || typeof plan.thesis !== 'string') errors.push('missing thesis');
  if (!Array.isArray(plan.parts) || !plan.parts.length) {
    errors.push('no parts');
    return { ok: false, errors, warnings };
  }
  const titles = new Set();
  let blocks = 0;
  for (const part of plan.parts) {
    if (!part.name || typeof part.name !== 'string') errors.push('a part has no name');
    if (!Array.isArray(part.blocks) || !part.blocks.length) {
      errors.push(`part "${part.name || '?'}" has no blocks`);
      continue;
    }
    for (const b of part.blocks) {
      if (!b.title || typeof b.title !== 'string') errors.push('a block has no title');
      else if (titles.has(b.title)) errors.push(`duplicate page title "${b.title}"`);
      else titles.add(b.title);
      if (!ARCH.has(b.archetype)) errors.push(`page "${b.title || '?'}" has unknown archetype "${b.archetype}"`);
      if (!b.topic || typeof b.topic !== 'string') errors.push(`page "${b.title || '?'}" has no topic`);
      blocks++;
    }
  }
  if (blocks < 3) warnings.push('very few pages. Is this source worth a book?');
  if (blocks > 30) warnings.push('a lot of pages. Consider trimming the parts.');
  if (plan.parts.length > 6) warnings.push('a lot of parts for this engine; the contents list will be long');
  if (pages != null && blocks !== pages) {
    warnings.push(`asked for ${pages} page(s), planned ${blocks}. Nothing was invented to make up the difference.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * One provider call → validated plan.
 *  env: merged env (from the server's BYOK merge). signal/fetchImpl injectable
 *  for the tests.
 */
export async function planFromSource({
  source, topic, provider, model, allowPaid = false, signal,
  fetchImpl, env = process.env, voice, extraBrief = '', lang = null, dir = null, pages = null,
}) {
  if (!source || !String(source).trim()) throw new Error('a source is required');
  const r = resolveProvider({ provider, model, allowPaid, env });
  const target = pages == null ? null : clampPages(pages);
  const user = [
    `TOPIC OR DIRECTION: ${topic || 'not specified — infer the best focus from the source'}`,
    target == null ? '' : `TARGET LENGTH: exactly ${target} page(s) in total, across all parts.`,
    '',
    `VOICE OF THE BOOK: ${voice || 'pointed, plain, second person, one idea per page'}`,
    '',
    lang ? `LANGUAGE: write the title, subtitle, thesis, every part name and every page title and topic in ${lang}${dir ? ` (${dir})` : ''}. Keep proper nouns, versions and numbers exactly as the source has them.` : '',
    extraBrief || '',
    '',
    'SOURCE MATERIAL FOLLOWS. Do not invent anything that is not supported by it.',
    '---',
    source,
  ].join('\n');

  const text = await complete(r, { system: PLAN_SYSTEM, user, signal, fetchImpl });
  const raw = extractJson(text);
  if (!raw) throw new Error('the model did not return JSON');
  let plan;
  try { plan = JSON.parse(raw); } catch { throw new Error('the planner returned broken JSON'); }
  const check = validatePlan(plan, { pages: target });
  if (!check.ok) throw new Error(`the plan did not validate: ${check.errors.join('; ')}`);
  return { plan, validation: check };
}

/* ------------------------------------------------------------ pages only
   The standalone "page pack" asks for N pages, not a book. Same discipline:
   one JSON object, N entries, known archetypes, and a mismatch is reported
   rather than padded. No parts, no title, no cover — there is no book. */

export const PAGES_SYSTEM = `You are the planning editor of a small-press page engine.
You are handed reading material and a requested page count. Produce a short,
concrete plan of exactly that many pages. Each page teaches ONE idea.

Output ONE valid JSON object. Nothing before it. Nothing after it. No fences.

JSON shape:
{
  "title": "a short name for this set of pages",
  "pages": [
    { "title": "the page's concept", "topic": "one line brief for that page",
      "archetype": "standard" }
  ]
}

Every page must declare its archetype:
  - "standard"    plain concept explainer, prose only
  - "procedure"   numbered steps to follow
  - "recipe"      what goes in, then how, then notes
  - "exercise"    a task with a stated goal and a check
  - "reference"   a lookup entry. The only one that may hold a table

Rules:
- Produce EXACTLY the requested number of pages, no more and no less.
- Each "title" is unique: it is how a page is addressed.
- Never invent facts, numbers, versions, dates, company names, quotes, or
  anecdotes. If the source does not support a claim, do not put it in the plan.
- Output JSON only.`.trim();

export function validatePages(plan) {
  const errors = [];
  const warnings = [];
  const ARCH = new Set(['standard', 'procedure', 'recipe', 'exercise', 'reference']);
  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['not an object'], warnings };
  if (!Array.isArray(plan.pages) || !plan.pages.length) {
    return { ok: false, errors: ['no pages'], warnings };
  }
  const titles = new Set();
  for (const p of plan.pages) {
    if (!p.title || typeof p.title !== 'string') errors.push('a page has no title');
    else if (titles.has(p.title)) errors.push(`duplicate page title "${p.title}"`);
    else titles.add(p.title);
    if (!ARCH.has(p.archetype)) errors.push(`page "${p.title || '?'}" has unknown archetype "${p.archetype}"`);
    if (!p.topic || typeof p.topic !== 'string') errors.push(`page "${p.title || '?'}" has no topic`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * One provider call → a validated page plan of exactly `pages` (or fewer if the
 * model refuses to fill it honestly; the shortfall is a warning, not fiction).
 */
export async function planPages({
  source, topic, pages = 1, provider, model, allowPaid = false, signal,
  fetchImpl, env = process.env, voice, archetype = 'standard', extraBrief = '', lang = null, dir = null,
}) {
  if (!source || !String(source).trim()) throw new Error('a source is required');
  const r = resolveProvider({ provider, model, allowPaid, env });
  const target = clampPages(pages);
  const user = [
    `NUMBER OF PAGES: exactly ${target}`,
    `PAGE SHAPE: ${archetype}`,
    `TOPIC OR DIRECTION: ${topic || 'infer the best focus from the source'}`,
    '',
    `VOICE: ${voice || 'pointed, plain, second person, one idea per page'}`,
    '',
    lang ? `LANGUAGE: write every title and topic in ${lang}${dir ? ` (${dir})` : ''}. Keep proper nouns, versions and numbers exactly as the source has them.` : '',
    extraBrief || '',
    '',
    'SOURCE MATERIAL FOLLOWS. Do not invent anything that is not supported by it.',
    '---',
    source,
  ].join('\n');

  const text = await complete(r, { system: PAGES_SYSTEM, user, signal, fetchImpl });
  const raw = extractJson(text);
  if (!raw) throw new Error('the model did not return a page plan as JSON');
  let plan;
  try { plan = JSON.parse(raw); } catch { throw new Error('the page planner returned broken JSON'); }
  const check = validatePages(plan);
  if (!check.ok) throw new Error(`the page plan did not validate: ${check.errors.join('; ')}`);
  if (plan.pages.length !== target) {
    check.warnings.push(`asked for ${target} page(s), planned ${plan.pages.length}. Nothing was invented to make up the difference.`);
  }
  /* A page shape the plan does not name takes the requested default rather than
     failing: the page drafter still validates the shape it is given. */
  const normalized = plan.pages.map((p) => ({ ...p, archetype: p.archetype || archetype }));
  return { plan: { title: plan.title || topic || 'Pages', pages: normalized }, validation: check };
}