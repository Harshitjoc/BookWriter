#!/usr/bin/env node
/**
 * make-paper.mjs — one LLM call that turns source text into a single
 * research-paper HTML document, then Playwright prints it to PDF.
 *
 *   node src/engine/tools/make-paper.mjs --source-file <file.txt> --out books/x/paper
 *
 * Not a book page. No B5. A long-form document read top to bottom.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolve as resolveProvider, complete } from './llm.mjs';

export const PAPER_SYSTEM = `You are a research writing assistant. Read the SOURCE and
write a complete, self-contained HTML research paper.

Output ONE valid HTML document. Start with <!doctype html>. Nothing before it,
nothing after it. No fences.

The document must follow this skeleton in order:

  <header class="paper-head">
    <h1>TITLE</h1>
    <p class="meta">one line about what this paper does and why it matters</p>
  </header>

  <abstract class="abstract">
    <h2>Abstract</h2>
    <p>one paragraph, 120-180 words, claim plus the main result plus the method.</p>
  </abstract>

  <section> <h2>1. Introduction</h2> ... </section>
  two or three more body sections
  <section> <h2>N. Conclusion</h2> ... </section>

  <footer class="paper-foot">a line noting this was drafted with the paper engine</footer>

Rules:
- The <head> links  "../../../src/engine/paper.css". Never inline styles or @media print.
- Every claim beyond common knowledge must follow from the SOURCE. If you are not
  sure, say the evidence is limited. Never invent a number, a citation, a name, or
  a "recent study".
- Number sections by hand (1., 2., 3.) like the example.
- Use <blockquote> for direct long quotes from the source.
- A figure is allowed if it genuinely helps: inline SVG only, and every <text> inside
  it carries an explicit fill. No <img> may point anywhere not on disk.
- No <script>. No external fonts.`.trim();

const SUBSTANCE = /<html|<!doctype/i;

export function validatePaperHtml(html) {
  const errors = [];
  if (!/<!doctype html>/i.test(html)) errors.push('missing <!doctype html>');
  if (!/<title>[^<]+<\/title>/i.test(html)) errors.push('missing <title>');
  if (!/<abstract/i.test(html)) errors.push('no abstract section');
  if (!/<h2>\s*1\.?\s*Introduction/i.test(html)) errors.push('no numbered introduction');
  if (/<script/i.test(html)) errors.push('a script tag made it through. forbidden.');
  if (/@media\s+print/i.test(html)) errors.push('a @media print rule. The stylesheet owns print.');
  if (!/<section>/i.test(html)) errors.push('no sections');
  return errors;
}

export function extractCode(text) {
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  return fence ? fence[1].trim() : text.trim();
}

export async function makePaper({ slug, source, topic, provider, model, allowPaid = false,
  signal, fetchImpl, env = process.env, bookRoot = 'books' }) {
  if (!source || !String(source).trim()) throw new Error('a source is required');
  const r = resolveProvider({ provider, model, allowPaid, env });

  const user = [
    `TOPIC OR FOCUS: ${topic || 'infer from the source'}`,
    '',
    'SOURCE MATERIAL. This is the entire evidence base for the paper.',
    '---',
    source,
  ].join('\n');

  const text = await complete(r, { system: PAPER_SYSTEM, user, signal, fetchImpl });
  const html = extractCode(text);
  const errors = validatePaperHtml(html);
  if (errors.length) {
    throw new Error(`the paper did not validate: ${errors.join('; ')}`);
  }

  const dir = path.join(bookRoot, slug, 'paper');
  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, 'paper.html');
  fs.writeFileSync(htmlPath, html);

  const pdfPath = path.join(dir, 'paper.pdf');
  let code = 0;
  let errTail = '';
  try {
    execFileSync(process.execPath, [path.join('src', 'engine', 'tools', 'export.mjs'), htmlPath, pdfPath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) { code = e.status ?? 1; errTail = String(e.stderr || e.message); }

  return { dir, htmlPath, pdfPath, code, errTail, html };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const argv = process.argv.slice(2);
  const srcFile = argv[argv.indexOf('--source-file') + 1];
  const slug = argv[argv.indexOf('--slug') + 1] || 'paper';
  const source = fs.readFileSync(srcFile, 'utf8');
  makePaper({ slug, source, topic: 'Untitled', provider: process.env.LLM_PROVIDER || 'ollama' })
    .then((r) => { console.log(`paper: ${r.pdfPath}\nexit: ${r.code}`); process.exit(r.code); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}