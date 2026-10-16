/* ==========================================================================
   test/harness.mjs  -  boot the real server on a free port, and a tiny reporter
   --------------------------------------------------------------------------
   These tests drive the actual src/server/index.mjs and the actual CLI tools.
   Nothing is mocked except the network in Phase 1's provider tests.

   A scratch book (books/uitest) is copied from books/starter and deleted
   afterwards, so a failing test can never leave a real book edited.
   ========================================================================== */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const __dir = path.dirname(fileURLToPath(import.meta.url));
export const UI_ROOT = path.resolve(__dir, '..');   // the repo root, which Vite serves
export const ROOT = path.resolve(__dir, '..');      // the repo root
/* Slugs must match the server's ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$, so these
   start with a letter. An underscore-prefixed name is silently ignored. */
export const SCRATCH = 'uitest';

let passed = 0;
const failures = [];

export function ok(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`    ok   ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`    FAIL ${name}${detail ? `  (${detail})` : ''}`);
  }
  return !!cond;
}

export function group(title) {
  console.log(`\n  ${title}`);
}

export function report(suite) {
  console.log(`\n  ${suite}: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`    - ${f}`);
    process.exitCode = 1;
  }
  return failures.length === 0;
}

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

/** Boot the server on a free port, wait until /api/books answers, then run fn.
 *  `extraEnv` is merged into the child's environment, which is how the draft
 *  tests point the local provider at a fake socket without any test-only code
 *  in the server itself. */
export async function withServer(fn, extraEnv = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, UI_PORT: String(port), UI_HOST: '127.0.0.1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`server did not come up on ${base}\n${stderr}`);
    }
    try {
      const r = await fetch(`${base}/api/books`);
      if (r.ok) break;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  try {
    return await fn(base, child);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Delete any scratch book a previous crashed run left behind, so the books
 *  listing is never polluted by the leftovers of a failure. Also sweeps the old
 *  underscore-prefixed names, which the slug validator used to let through. */
export function cleanStale(...slugs) {
  const books = path.join(ROOT, 'books');
  for (const s of slugs) fs.rmSync(path.join(books, s), { recursive: true, force: true });
  try {
    for (const e of fs.readdirSync(books, { withFileTypes: true })) {
      if (e.isDirectory() && /^_ui|^ui(test|custom|new)$/.test(e.name)) {
        fs.rmSync(path.join(books, e.name), { recursive: true, force: true });
      }
    }
  } catch { /* no books dir */ }
}

/** Run fn with books/uitest present, and remove it afterwards EVEN IF fn throws.
 *  Best-effort cleanup is how scratch books leak into the next run. */
export async function withScratch(fn) {
  makeScratch();
  try {
    return await fn();
  } finally {
    dropScratch();
  }
}

/** Copy books/starter -> books/uitest and give it a slug-matching interior. */
export function makeScratch() {
  const from = path.join(ROOT, 'books', 'starter');
  const to = path.join(ROOT, 'books', SCRATCH);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  for (const f of ['book.html', 'book.pdf', 'book-free.html', 'book-free.pdf']) {
    fs.rmSync(path.join(to, f), { force: true });
  }
  for (const f of fs.readdirSync(to)) {
    if (/^page\d+\.png$/.test(f)) fs.rmSync(path.join(to, f), { force: true });
  }
  const stale = path.join(to, 'starter.html');
  if (fs.existsSync(stale)) fs.renameSync(stale, path.join(to, `${SCRATCH}.html`));
  return to;
}

export function dropScratch() {
  fs.rmSync(path.join(ROOT, 'books', SCRATCH), { recursive: true, force: true });
}

/** Read an SSE POST to /api/run into {code, lines, result}. */
export async function runTool(base, tool, book, edition) {
  const { events } = await readSSE(base, '/api/run', { tool, book, edition });
  let code = null, result = null;
  const lines = [];
  for (const e of events) {
    if (e.event === 'line') lines.push(e.data.text);
    if (e.event === 'done') { code = e.data.code; result = e.data.result; }
  }
  return { code, lines, result };
}

/** POST an SSE endpoint and collect every event in order. */
export async function readSSE(base, p, payload) {
  const res = await fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { status: res.status, error: body.error, events: [] };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', events = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let c;
    while ((c = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, c); buf = buf.slice(c + 2);
      let event = 'line'; const data = [];
      for (const row of frame.split('\n')) {
        if (row.startsWith('event:')) event = row.slice(6).trim();
        else if (row.startsWith('data:')) data.push(row.slice(5).trim());
      }
      if (data.length) events.push({ event, data: JSON.parse(data.join('\n')) });
    }
  }
  return { status: res.status, events };
}

/** Open an SSE endpoint but stop reading after `onStart` returns true, so a
 *  request can be cancelled mid-flight instead of only after it finishes. */
export async function openSSE(base, p, payload, onStart) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  });
  if (!res.ok) return { status: res.status, events: [], stop: () => {} };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', events = [];
  const readAll = async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let c;
      while ((c = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, c); buf = buf.slice(c + 2);
        let event = 'line'; const data = [];
        for (const row of frame.split('\n')) {
          if (row.startsWith('event:')) event = row.slice(6).trim();
          else if (row.startsWith('data:')) data.push(row.slice(5).trim());
        }
        if (data.length) events.push({ event, data: JSON.parse(data.join('\n')) });
      }
    }
  };
  await readAll();
  const stop = () => { ctrl.abort(); };
  void onStart;
  return { status: res.status, events, stop, readAll };
}

/** Run an engine tool straight from the command line, the way a person would.
 *  Returns {code, stdout, stderr}. Used by the format tests, which are about
 *  what the CLI does, not about what the UI does with it. */
export function cli(script, ...args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'src', 'engine', 'tools', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Copy books/starter to books/<slug>, optionally patch its book.json, and give
 *  back a cleanup function. Used for format and theme tests, which each need
 *  their own throwaway book. */
export function scratchBook(slug, patch = {}) {
  const to = path.join(ROOT, 'books', slug);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'books', 'starter'), to, { recursive: true });
  for (const f of ['book.html', 'book.pdf', 'book-free.html', 'book-free.pdf']) {
    fs.rmSync(path.join(to, f), { force: true });
  }
  /* The interior is named after the slug, so rename it to match. */
  const stale = path.join(to, 'starter.html');
  if (fs.existsSync(stale)) fs.renameSync(stale, path.join(to, `${slug}.html`));

  if (Object.keys(patch).length) {
    const jp = path.join(to, 'book.json');
    const json = JSON.parse(fs.readFileSync(jp, 'utf8'));
    Object.assign(json, patch);
    fs.writeFileSync(jp, JSON.stringify(json, null, 2) + '\n');
  }
  return {
    dir: to,
    slug,
    interior: path.join(to, `${slug}.html`),
    json: () => JSON.parse(fs.readFileSync(path.join(to, 'book.json'), 'utf8')),
    drop: () => fs.rmSync(to, { recursive: true, force: true }),
  };
}

/** A fake OpenAI-compatible model on a real socket.
 *
 *  The draft tests point OLLAMA_BASE_URL at this instead of a real provider.
 *  Nothing in the server or the engine knows it is fake: it is a real HTTP
 *  server speaking the real protocol, which is exactly what a local model is.
 *  `hold` makes it never answer, which is how the cancel test gets a request
 *  that is genuinely still in flight. */
export async function fakeModel({ status = 200, content = 'x', hold = false } = {}) {
  const http = await import('node:http');
  const sockets = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (hold) return;                                  // never answers
      let reply;
      try {
        req.lastBody = JSON.parse(body);
      } catch { /* malformed is the caller's problem */ }
      if (status !== 200) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'nope' } }));
      }
      reply = { choices: [{ message: { content } }] };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply));
    });
  });
  server.on('connection', (s) => { sockets.push(s); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    server,
    close: () => {
      for (const s of sockets) s.destroy();               // a held request must not keep it alive
      return new Promise((r) => server.close(r));
    },
  };
}