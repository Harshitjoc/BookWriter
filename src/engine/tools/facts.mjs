/* ==========================================================================
   facts.mjs  -  list the open questions in a book
   --------------------------------------------------------------------------
   Every [FACT NEEDED: ...] marker in a book is a place where a fact was not
   known, so it was flagged instead of invented. This prints them, page by page,
   so the list can be worked through. Exits 1 while any remain, unless --allow.

   Usage:
       node src/engine/tools/facts.mjs books/<slug>
       node src/engine/tools/facts.mjs books/<slug> --json
       node src/engine/tools/facts.mjs books/<slug> --allow   # report, always exit 0
   ========================================================================== */
import { scanBookDir } from './lib/facts.mjs';

const argv = process.argv.slice(2);
const bookDir = argv.find((a) => !a.startsWith('--'));
if (!bookDir) {
  console.error('Usage: node src/engine/tools/facts.mjs books/<slug> [--json] [--allow]');
  process.exit(1);
}
const asJson = argv.includes('--json');
const allow = argv.includes('--allow');

let result;
try {
  result = scanBookDir(bookDir);
} catch (e) {
  console.error(`cannot read the book: ${e.message}`);
  process.exit(1);
}

if (asJson) {
  console.log(JSON.stringify({ count: result.count, facts: result.facts }));
} else if (result.count === 0) {
  console.log(`no open facts in ${bookDir}. The book is ready to publish.`);
} else {
  console.log(`${result.count} open fact${result.count > 1 ? 's' : ''} in ${bookDir}:`);
  for (const f of result.facts) {
    console.log(`  page ${String(f.page).padStart(2)}  ${f.title}${f.text ? `  — ${f.text}` : ''}`);
  }
  console.log('\nResolve each marker, then run this again.');
}

process.exit(result.count && !allow ? 1 : 0);
