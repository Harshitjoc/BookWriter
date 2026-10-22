/* Every call the UI makes. Nothing here re-implements the engine: /api/run
   spawns the same scripts the command line runs, and /preview serves the real
   generated book.html off disk. */

import { loadKeys } from '../../shared/byok.js';

async function json(url, opts) {
  const r = await fetch(url, opts);
  let j;
  try { j = await r.json(); } catch { j = null; }
  if (!r.ok) throw new Error((j && j.error) || `request failed (${r.status})`);
  if (j && j.error) throw new Error(j.error);
  return j;
}

/* One SSE reader for the three streaming endpoints. The frame parser used to
   be copied three times, which is three places to forget the trailing-frame
   flush and three places to get "the stream ended without a result" wrong.

   Ending without a `done` event is never success. It means the connection
   died, the child was killed, or the server crashed after it opened the
   stream — and every caller used to treat that as code 0 with an empty
   payload, which is how a failed export reported itself as exported. */
async function readSSE(res, { onStart, onLine, onPlan } = {}) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  const frames = (text) => {
    let event = 'line';
    const dataLines = [];
    for (const raw of text.split('\n')) {
      if (raw.startsWith('event:')) event = raw.slice(6).trim();
      else if (raw.startsWith('data:')) dataLines.push(raw.slice(5).trim());
    }
    if (!dataLines.length) return null;
    try { return { event, data: JSON.parse(dataLines.join('\n')) }; } catch { return null; }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) !== -1) {
      const frame = frames(buf.slice(0, cut));
      buf = buf.slice(cut + 2);
      if (!frame) continue;
      if (frame.event === 'start') onStart?.(frame.data);
      else if (frame.event === 'line') onLine?.(frame.data);
      else if (frame.event === 'plan') onPlan?.(frame.data);
      else if (frame.event === 'done') return frame.data;
    }
  }
  const tail = frames(buf);
  if (tail && tail.event === 'done') return tail.data;
  throw new Error('the stream ended before the tool reported a result');
}

async function stream(url, body, handlers, signal) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('cancelled', { cause: e });
    throw new Error('could not reach the server', { cause: e });
  }
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || 'the server refused that request');
  }
  return readSSE(res, handlers);
}

export const getBooks = () => json('/api/books');
export const getHealth = () => json('/api/health');

export const getFile = async (book, name) => {
  const j = await json(`/api/file?book=${encodeURIComponent(book)}&name=${encodeURIComponent(name)}`);
  return j.text;
};

export const saveFile = (book, name, text) =>
  json(`/api/file?book=${encodeURIComponent(book)}&name=${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

export const getShots = (book) => json(`/api/shots?book=${encodeURIComponent(book)}`);

export const newBook = (slug, template) =>
  json('/api/new-book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, ...(template ? { template } : {}) }),
  });

/* The scaffolds the new-book picker may offer, in catalog order. */
export const getTemplates = () => json('/api/templates');

export const cancelRun = (id) => fetch(`/api/cancel?id=${encodeURIComponent(id)}`);

/* Remove a whole book folder, generated output included. `confirm` must equal
   the slug: the server refuses a delete the UI did not mean. */
export const deleteBook = (slug, confirm) =>
  json('/api/delete-book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, confirm }),
  });

/* Which providers exist, and which of them would cost money. */
export const getProviders = () => json('/api/providers');

export const getFontPacks = () => json('/api/font-packs');

/* Phase 7: the diagram studio's shapes and a compiled example. */
export const getDiagramShapes = () => json('/api/diagram');

export const getDiagramExample = (kind) =>
  json(`/api/diagram/example?kind=${encodeURIComponent(kind)}`);

/* Compile a spec to SVG. A bad spec is a 400 with an explanation, not a crash. */
export const compileDiagram = async (spec) => {
  const r = await fetch('/api/diagram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'the diagram did not compile');
  return j.svg;
};

export const getFacts = (book) => json(`/api/facts?book=${encodeURIComponent(book)}`);

export const getBoard = (book) => json(`/api/board?book=${encodeURIComponent(book)}`);

/* Ask a model for one page. Same event shape as run(): 'start', then one 'line'
 * per line of the page as it arrives, then 'done' with the validation.
 *
 * A refusal (a paid provider without permission, a missing key) comes back as a
 * plain HTTP error rather than a stream, so the full explanation reaches the
 * screen instead of being one line inside a 200. */
export function draft(book, payload, { onLine, onStart, signal } = {}) {
  return stream('/api/draft', {
    book,
    ...payload,
    keys: payload?.keys ?? loadKeys(),
  }, { onLine, onStart }, signal);
}

export function fromSource(payload, { onLine, onStart, onPlan, signal } = {}) {
  return stream('/api/from-source', { keys: loadKeys(), ...payload }, { onLine, onStart, onPlan }, signal);
}

/* The saved plan for a book's video, or null when none has been saved. */
export const getStoryboard = (book) => json(`/api/storyboard?book=${encodeURIComponent(book)}`);

/* Save a storyboard only after the server's own validator accepts it. A bad
 * plan is a plain HTTP error with the reasons, not a file on disk. */
export const saveStoryboard = (book, storyboard) =>
  json('/api/storyboard', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ book, storyboard }),
  });

/* Plan a video with a model. Same start/done shape as draft(). Nothing is
 * written; the browser gets the storyboard and a person decides what to save. */
export function storyboardPlan(payload, { onLine, onStart, signal } = {}) {
  return stream('/api/storyboard/plan', { keys: loadKeys(), ...payload }, { onLine, onStart }, signal);
}

/* Runs a tool and streams its output back through onLine as it arrives, so the
   console fills in live rather than appearing all at once when it finishes.
   Resolves with { code, result }. */
export function run(tool, book, { edition, onLine, onStart, args, signal } = {}) {
  return stream('/api/run', {
    tool, book, edition: edition || undefined,
    keys: (args && args.keys) || loadKeys(),
    ...(args || {}),
  }, { onLine, onStart }, signal);
}
