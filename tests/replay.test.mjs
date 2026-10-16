/* ==========================================================================
   replay.test.mjs  -  a generation is recorded, and can be replayed offline
   --------------------------------------------------------------------------
   The promise: run a draft once, and the same request never re-rolls. The
   second run comes from the ledger, byte for byte, with no network. And a
   replay that has nothing to replay says so instead of quietly calling out.

   The book is a scratch copy of starter; .gen/ lands there and is removed with
   the book, so nothing real is touched.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { ok, group, report, scratchBook, ROOT } from './harness.mjs';
import { resolve, complete } from '../src/engine/tools/llm.mjs';
import { makeStore, readManifest, ledgerPaths } from '../src/engine/tools/gen-ledger.mjs';
import { draftBlock } from '../src/engine/tools/draft-block.mjs';

const openaiReply = (content) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
  text: async () => '',
});

group('the ledger records one line and one cache file per generation');
await (async () => {
  const book = scratchBook('uitest');
  try {
    const dir = book.dir;
    const seen = [];
    const fetchImpl = async (url, opts) => { seen.push(JSON.parse(opts.body)); return openaiReply('FIRST'); };

    const r = resolve({ provider: 'ollama' });
    const store = makeStore(dir);
    const a = await complete(r, { system: 's', user: 'u', cache: store, fetchImpl });
    ok('the first call reaches the model', a === 'FIRST' && seen.length === 1);

    const b = await complete(r, { system: 's', user: 'u', cache: store, fetchImpl });
    ok('the second call is served from the cache', b === 'FIRST' && seen.length === 1);
    ok('and it is marked replayed', store.replayed === true);

    const c = await complete(r, { system: 's', user: 'a different prompt', cache: store, fetchImpl });
    ok('a different request is a miss and calls again', c === 'FIRST' && seen.length === 2);

    const files = fs.readdirSync(ledgerPaths(dir).cache);
    ok('one cache file per distinct request', files.length === 2, files.join(','));
    const manifest = readManifest(dir);
    ok('the manifest has one line per generation', manifest.length === 2);
    ok('an entry carries provider, model and an output hash',
      manifest[0].provider === 'ollama' && manifest[0].model && manifest[0].outputHash);

    /* A miss in replay mode is a refusal, not another call. */
    const offline = makeStore(dir, { replay: true });
    let threw = null;
    try { await complete(r, { system: 's', user: 'never recorded', cache: offline, fetchImpl }); }
    catch (e) { threw = e; }
    ok('replay refuses a request that was never recorded', !!threw && /nothing cached/.test(threw.message));
    ok('replay never reaches the model', seen.length === 2);
  } finally { book.drop(); }
})();

group('a seed is sent, and recorded');
await (async () => {
  const book = scratchBook('uitest');
  try {
    const bodies = [];
    const fetchImpl = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return openaiReply('PAGE'); };
    const r = resolve({ provider: 'openai', allowPaid: true, env: { OPENAI_API_KEY: 'sk-test' } });

    await complete(r, { system: 's', user: 'u', seed: 7, fetchImpl });
    ok('a seed reaches the request body', bodies[0].seed === 7, JSON.stringify(bodies[0].seed));

    await complete(r, { system: 's', user: 'u', fetchImpl });
    ok('no seed means no seed field', !('seed' in bodies[1]));
  } finally { book.drop(); }
})();

group('the drafter writes the ledger and can be replayed');
await (async () => {
  const book = scratchBook('uitest');
  try {
    const bodies = [];
    const page = '<section class="sheet bb"><h2 class="sr">A sentence.</h2></section>';
    const fetchImpl = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return openaiReply(page); };

    const first = await draftBlock({
      bookDir: book.dir, topic: 'a topic', provider: 'ollama', seed: 42,
      ledger: true, fetchImpl,
    });
    ok('the draft is recorded (ledger on) with its seed',
      first.meta.ledger === true && first.meta.seed === 42 && first.meta.requestKey);
    ok('a provenance line is produced', typeof first.provenance === 'string' && /seed 42/.test(first.provenance));
    ok('the manifest and a cache file exist',
      fs.existsSync(ledgerPaths(book.dir).manifest)
      && fs.readdirSync(ledgerPaths(book.dir).cache).length === 1);
    ok('the seed reached the model', bodies[0].seed === 42);

    /* Replay: same params, a fetch that would throw if it were ever called. */
    const replayed = await draftBlock({
      bookDir: book.dir, topic: 'a topic', provider: 'ollama', seed: 42,
      ledger: true, replay: true,
      fetchImpl: async () => { throw new Error('the model must not be called during replay'); },
    });
    ok('replay returns the recorded page', replayed.section === first.section);
    ok('replay is flagged as replayed', replayed.meta.replayed === true);
    ok('the model was never called again', bodies.length === 1);
  } finally { book.drop(); }
})();

group('without a ledger, nothing is written');
await (async () => {
  const book = scratchBook('uitest');
  try {
    await draftBlock({ bookDir: book.dir, topic: 'x', provider: 'ollama', fetchImpl: async () => openaiReply('P') });
    ok('no .gen is created when the ledger is off', !fs.existsSync(path.join(book.dir, '.gen')));
  } finally { book.drop(); }
})();

report('replay');
