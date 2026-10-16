/* ==========================================================================
   lib/facts.mjs  -  the fact ledger: find every [FACT NEEDED: ...] marker
   --------------------------------------------------------------------------
   A page is never allowed to invent a number or a story. Where the drafter (or
   a person) did not know a fact, it leaves a marker:

       [FACT NEEDED: the current Bank Rate]

   Those markers are the book's open questions. This module finds them, and
   attributes each one to the page it sits on, so a report can say not just
   "there are 3" but "page 7, 'The emergency fund', needs the exact figure".
   Publishing refuses while any remain — see tools/publish.mjs.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { splitSheets } from './book-html.mjs';

export const FACT_RE = /\[FACT NEEDED(?::\s*([^\]]*?))?\]/g;

/** Every marker in a string, with its (trimmed) payload. */
export function findFacts(text) {
  const out = [];
  const re = new RegExp(FACT_RE.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    out.push({ raw: m[0], text: (m[1] || '').trim() });
  }
  return out;
}

/**
 * Scan all sheets of an interior (or built book) file. Each fact is tagged with
 * a page number (the sheet's position) and the page title.
 */
export function scanBook(file) {
  const html = fs.readFileSync(path.resolve(file), 'utf8');
  const sheets = splitSheets(html);
  const facts = [];
  sheets.forEach((s, i) => {
    for (const f of findFacts(s.html)) {
      facts.push({ page: i + 1, title: s.title, ...f });
    }
  });
  return { count: facts.length, facts };
}

/** Resolve the interior file for a book folder, the way build-book.mjs does. */
export function interiorOf(bookDir) {
  const dir = path.resolve(bookDir);
  const slug = path.basename(dir);
  let interior = `${slug}.html`;
  const jp = path.join(dir, 'book.json');
  if (fs.existsSync(jp)) {
    try { interior = JSON.parse(fs.readFileSync(jp, 'utf8')).interior || interior; } catch { /* default */ }
  }
  return path.join(dir, interior);
}

export function scanBookDir(bookDir) {
  const file = interiorOf(bookDir);
  const result = scanBook(file);
  return { ...result, file };
}
