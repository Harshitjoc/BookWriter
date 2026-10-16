/* ==========================================================================
   gen-ledger.mjs  -  a book remembers how each page was generated
   --------------------------------------------------------------------------
   A model call is a fact about a page: which provider, which model, which
   prompt, which seed, and what it said. Without a record, a rebuild is a
   re-roll: run it twice and page 6 is different, and there is no way to say
   what changed it. This keeps that record, per book, in a dotdir the preview
   will never serve:

     books/<slug>/.gen/manifest.jsonl      one line per generation, append-only
     books/<slug>/.gen/cache/<key>.json    the exact text, so it can be replayed

   The key is a hash of the WHOLE request (provider, model, messages, params,
   seed), so the same prompt against the same model resolves to the same key and
   the cached page is returned byte for byte — even offline.

   Usage from a caller:

     const store = makeStore(bookDir, { replay });
     await complete(provider, { system, user, cache: store, seed });

   store.get(key) returns cached text, or null (or throws, in replay mode).
   store.put(key, text, meta) writes the cache file and appends the manifest.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const LEDGER_DIRNAME = '.gen';

export function ledgerPaths(bookDir) {
  const dir = path.join(bookDir, LEDGER_DIRNAME);
  return { dir, manifest: path.join(dir, 'manifest.jsonl'), cache: path.join(dir, 'cache') };
}

/** JSON with object keys sorted, so the same request always hashes the same. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** A short, stable id for a whole request. */
export function requestKey(input) {
  return sha(stableStringify(input)).slice(0, 16);
}

/** A short, stable id for a piece of text (the model's answer). */
export function contentHash(text) {
  return sha(text).slice(0, 16);
}

/**
 * A cache bound to one book. `replay` turns a miss into an error instead of a
 * silent call to the model: a rebuild that claims to be offline must fail loud
 * when the page it needs was never recorded.
 */
export function makeStore(bookDir, { replay = false } = {}) {
  const { manifest, cache } = ledgerPaths(bookDir);
  const store = {
    replay,
    last: null,       // the key touched most recently, for provenance
    lastEntry: null,  // the manifest entry for that key
    replayed: false,  // true once a get() returned a hit
    get(key) {
      store.last = key;
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(cache, `${key}.json`), 'utf8'));
        store.replayed = true;
        store.lastEntry = entry;
        return entry.text;
      } catch {
        if (replay) {
          throw new Error(
            `nothing cached for request ${key}. This book was not generated with this exact ` +
            'prompt, model and seed, so there is nothing to replay. Drop --replay to call the model.');
        }
        return null;
      }
    },
    put(key, text, meta = {}) {
      store.last = key;
      fs.mkdirSync(cache, { recursive: true });
      const entry = {
        key,
        ts: new Date().toISOString(),
        ...meta,
        outputHash: contentHash(text),
      };
      store.lastEntry = entry;
      fs.writeFileSync(path.join(cache, `${key}.json`), JSON.stringify({ ...entry, text }, null, 2) + '\n');
      fs.appendFileSync(manifest, JSON.stringify(entry) + '\n');
    },
  };
  return store;
}

/** Every manifest line for a book, oldest first. Empty when it never generated. */
export function readManifest(bookDir) {
  const { manifest } = ledgerPaths(bookDir);
  try {
    return fs.readFileSync(manifest, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** The one-line provenance string stamped on a generated page. */
export function provenance(entry) {
  if (!entry) return null;
  const bits = [`generated ${entry.ts}`, `via ${entry.provider}/${entry.model}`];
  if (entry.seed != null) bits.push(`seed ${entry.seed}`);
  bits.push(`key ${entry.key}`);
  return bits.join(' · ');
}
