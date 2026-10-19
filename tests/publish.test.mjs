/* ==========================================================================
   test/publish.test.mjs  -  the fact ledger, and the gate that will not ship
   --------------------------------------------------------------------------
   A [FACT NEEDED: ...] marker is the engine's way of saying "I did not know
   this, so I did not invent it". These tests prove that the marker is found,
   that it is attributed to the right page, and that publish.mjs refuses to
   export anything while one remains — then exports cleanly once it is gone.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { ok, group, report, cli, scratchBook } from './harness.mjs';
import { findFacts, scanBook } from '../src/engine/tools/lib/facts.mjs';

/* ---------------------------------------------------------------- ledger */
group('the fact ledger finds and attributes markers');
{
  const found = findFacts('a [FACT NEEDED: the Bank Rate] and [FACT NEEDED] and none');
  ok('a marker with a detail is found', found.length === 2);
  ok('the detail is captured', found[0].text === 'the Bank Rate', found[0].text);
  ok('a bare marker is found too', found[1].text === '');

  const many = findFacts('[FACT NEEDED: x] [FACT NEEDED: x]');
  ok('the same marker twice is counted twice', many.length === 2, String(many.length));
  ok('plain text has no facts', findFacts('nothing to see').length === 0);
}

/* ------------------------------------------------------------ the gate */
const b = scratchBook('uitest');

const marker = '[FACT NEEDED: the exact figure from the RFC]';
let interior = fs.readFileSync(b.interior, 'utf8');
interior = interior.replace(/(<h2 class="sr">[\s\S]*?)<\/h2>/, `$1 ${marker}</h2>`);
fs.writeFileSync(b.interior, interior);

group('the open fact is attributed to its page');
{
  const scan = scanBook(b.interior);
  ok('one fact is found', scan.count === 1, String(scan.count));
  ok('it carries the page title', scan.facts[0].title === 'SSRF', scan.facts[0].title);
  ok('it carries the detail', /RFC/.test(scan.facts[0].text), scan.facts[0].text);
}

group('facts.mjs reports the open question');
{
  const r = cli('facts.mjs', 'books/uitest');
  ok('it exits 1 while a fact remains', r.code === 1);
  ok('it names the page', /page\s+1\s+SSRF/.test(r.stdout), r.stdout.split('\n')[0]);
  ok('it names the missing fact', /RFC/.test(r.stdout));

  const j = cli('facts.mjs', 'books/uitest', '--json');
  const meta = JSON.parse(j.stdout.trim());
  ok('--json counts them', meta.count === 1 && meta.facts.length === 1);

  const allow = cli('facts.mjs', 'books/uitest', '--allow');
  ok('--allow reports but exits 0', allow.code === 0 && /open fact/.test(allow.stdout));
}

group('publish refuses while the fact is open');
{
  fs.rmSync(path.join(b.dir, 'book.pdf'), { force: true });
  const r = cli('publish.mjs', 'books/uitest', '--formats', 'pdf,epub,web');
  ok('publish exits 1', r.code === 1, String(r.code));
  ok('it says the book has an open fact', /open fact/i.test(r.stderr), r.stderr.slice(0, 120));
  ok('nothing was exported', !fs.existsSync(path.join(b.dir, 'book.pdf'))
    && !fs.existsSync(path.join(b.dir, 'book.epub'))
    && !fs.existsSync(path.join(b.dir, 'book-web.html')));

  const bad = cli('publish.mjs', 'books/uitest', '--formats', 'pdf,docx');
  ok('an unknown format is refused', bad.code === 1 && /unknown format/.test(bad.stderr));
}

group('resolving the fact opens the gate');
{
  fs.writeFileSync(b.interior, fs.readFileSync(b.interior, 'utf8').replace(marker, 'section 3.4'));
  const r = cli('facts.mjs', 'books/uitest');
  ok('facts.mjs is now happy', r.code === 0 && /no open facts/.test(r.stdout));

  const pub = cli('publish.mjs', 'books/uitest', '--formats', 'pdf,epub,web', '--out-dir', b.dir);
  ok('publish exits 0', pub.code === 0, pub.stderr.slice(0, 240));
  ok('it built', /built wrote \d+ pages/.test(pub.stdout), pub.stdout.split('\n')[0]);
  ok('it passed the fit check', /every page is 0 mm/.test(pub.stdout));
  ok('it passed the deep pass', /deep pass is clean/.test(pub.stdout));
  ok('it skips pixels when none were approved', /no approved snapshots/.test(pub.stdout));

  ok('a PDF was written', fs.existsSync(path.join(b.dir, 'book.pdf')));
  ok('an EPUB was written', fs.existsSync(path.join(b.dir, 'book.epub')));
  ok('a web file was written', fs.existsSync(path.join(b.dir, 'book-web.html')));
  ok('it reports what it published', /published: 3 files/.test(pub.stdout), pub.stdout.trim().split('\n').pop());
}

b.drop();
report('publish');
