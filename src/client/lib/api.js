/* Every call the UI makes. Nothing here re-implements the engine: /api/run
   spawns the same scripts the command line runs, and /preview serves the real
   generated book.html off disk. */

import { loadKeys } from '../../shared/byok.js';

export const getBooks = async () => (await fetch('/api/books')).json();

export const getHealth = async () => (await fetch('/api/health')).json();

export const getFile = async (book, name) => {
  const r = await fetch(`/api/file?book=${encodeURIComponent(book)}&name=${encodeURIComponent(name)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'could not read that file');
  return j.text;
};

export const saveFile = async (book, name, text) => {
  const r = await fetch(
    `/api/file?book=${encodeURIComponent(book)}&name=${encodeURIComponent(name)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) },
  );
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'could not save');
  return j;
};

export const getShots = async (book) =>
  (await fetch(`/api/shots?book=${encodeURIComponent(book)}`)).json();

export const newBook = async (slug) => {
  const r = await fetch('/api/new-book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'could not create that book');
  return j;
};

export const cancelRun = (id) => fetch(`/api/cancel?id=${encodeURIComponent(id)}`);

/* Which providers exist, and which of them would cost money. */
export const getProviders = async () => (await fetch('/api/providers')).json();

export const getFontPacks = async () => (await fetch('/api/font-packs')).json();
export const getPacks = getFontPacks;

/* Phase 7: the diagram studio's shapes and a compiled example. */
export const getDiagramShapes = async () => (await fetch('/api/diagram')).json();

export const getDiagramExample = async (kind) =>
  (await fetch(`/api/diagram/example?kind=${encodeURIComponent(kind)}`)).json();

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

export const getFacts = async (book) =>
  (await fetch(`/api/facts?book=${encodeURIComponent(book)}`)).json();

export const getBoard = async (book) =>
  (await fetch(`/api/board?book=${encodeURIComponent(book)}`)).json();

/* Ask a model for one page. Same event shape as run(): 'start', then one 'line'
 * per line of the page as it arrives, then 'done' with the validation.
 *
 * A refusal (a paid provider without permission, a missing key) comes back as a
 * plain HTTP error rather than a stream, so the full explanation reaches the
 * screen instead of being one line inside a 200. */
export function draft(book, payload, { onLine, onStart } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    (async () => {
      let res;
      try {
        res = await fetch('/api/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ book, ...payload, keys: payload?.keys ?? loadKeys() }),
        });
      } catch (e) {
        if (!settled) { settled = true; reject(new Error('could not reach the server')); }
        return;
      }
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        settled = true;
        reject(new Error(j.error || 'the server refused to draft that'));
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          let event = 'line';
          const dataLines = [];
          for (const raw of frame.split('\n')) {
            if (raw.startsWith('event:')) event = raw.slice(6).trim();
            else if (raw.startsWith('data:')) dataLines.push(raw.slice(5).trim());
          }
          if (!dataLines.length) continue;
          let data;
          try { data = JSON.parse(dataLines.join('\n')); } catch { continue; }
          if (event === 'start') onStart?.(data);
          else if (event === 'line') onLine?.(data);
          else if (event === 'done') { settled = true; resolve(data); }
        }
      }
      if (!settled) { settled = true; resolve({ code: 0, section: '', validation: null }); }
    })().catch((e) => {
      if (!settled) { settled = true; reject(e); }
    });
  });
}

export function fromSource(payload, { onLine, onStart, onPlan } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    (async () => {
      let res;
      try {
        res = await fetch('/api/from-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: loadKeys(), ...payload }),
        });
      } catch (e) {
        if (!settled) { settled = true; reject(new Error('could not reach the server')); }
        return;
      }
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        if (!settled) { settled = true; reject(new Error(j.error || 'the server refused that request')); }
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          let event = 'line';
          const dataLines = [];
          for (const raw of frame.split('\n')) {
            if (raw.startsWith('event:')) event = raw.slice(6).trim();
            else if (raw.startsWith('data:')) dataLines.push(raw.slice(5).trim());
          }
          if (!dataLines.length) continue;
          let data;
          try { data = JSON.parse(dataLines.join('\n')); } catch { continue; }
          if (event === 'start') onStart?.(data);
          else if (event === 'line') onLine?.(data);
          else if (event === 'plan') onPlan?.(data);
          else if (event === 'done') { settled = true; resolve(data); }
        }
      }
      if (!settled) { settled = true; resolve({ code: 0, result: null }); }
    })().catch((e) => { if (!settled) { settled = true; reject(e); } });
  });
}

/* Runs a tool and streams its output back through onLine as it arrives, so the
   console fills in live rather than appearing all at once when it finishes.
   Resolves with { code, result }. */
export function run(tool, book, { edition, onLine, onStart, args } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const controller = new AbortController();

    (async () => {
      let res;
      try {
        res = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            tool, book, edition: edition || undefined,
            keys: (args && args.keys) || loadKeys(),
            ...(args || {}),
          }),
        });
      } catch (e) {
        if (!settled) { settled = true; reject(new Error('could not reach the server')); }
        return;
      }
      if (!res.ok || !res.body) {
        settled = true;
        reject(new Error(`the server refused to run ${tool}`));
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        /* server-sent events: events separated by a blank line */
        let cut;
        while ((cut = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          let event = 'line';
          const dataLines = [];
          for (const raw of frame.split('\n')) {
            if (raw.startsWith('event:')) event = raw.slice(6).trim();
            else if (raw.startsWith('data:')) dataLines.push(raw.slice(5).trim());
          }
          if (!dataLines.length) continue;
          let data;
          try { data = JSON.parse(dataLines.join('\n')); } catch { continue; }

          if (event === 'start') onStart?.(data);
          else if (event === 'line') onLine?.(data);
          else if (event === 'done') { settled = true; resolve(data); }
        }
      }
      if (!settled) { settled = true; resolve({ code: 0, result: null }); }
    })().catch((e) => {
      if (!settled) { settled = true; reject(e); }
    });
  });
}