#!/usr/bin/env node
/**
 * source-intake.mjs — turn whatever the user gave us into one flat text bundle.
 *
 *   topic, youtube url, web page, pdf, docx, md, txt, html, csv
 *
 * Same discipline as every other tool in engine/: with no source it refuses to
 * invent one, and with a source it says what it could not use.
 */
import fs from 'node:fs';
import path from 'node:path';

export const LIMIT_CHARS = 60000;

/** Pull text out of a PDF. */
async function fromPdf(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => (it.str || '')).join(''));
  }
  return { text: pages.join('\n\n'), pages: doc.numPages };
}

/** Pull raw text out of a .docx. */
async function fromDocx(file) {
  const mammoth = await import('mammoth');
  const res = await mammoth.extractRawText({ path: file });
  return { text: res.value, messages: res.messages };
}

/** Get the captions for a YouTube link. Metadata-only when none exist. */
async function fromYouTube(url) {
  const mod = await import('youtube-transcript');
  const fetchImpl = mod.fetchTranscript || mod.default?.fetchTranscript;
  if (!fetchImpl) throw new Error('youtube-transcript does not export fetchTranscript');
  try {
    const entries = await fetchImpl(url);
    const text = entries.map((e) => e.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('empty transcript');
    return { text, metadataOnly: false };
  } catch (e) {
    /* YouTube with no captions, a private video, or a blocked fetch. Give back
       the title+description via the public oEmbed endpoint if that works, and
       tell the caller it is metadata only. */
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      const o = await res.json();
      return { text: '', metadataOnly: true, title: o.title || '', author: o.author_name || '', reason: e.message };
    } catch {
      throw new Error(`no captions and no metadata: ${e.message}`);
    }
  }
}

/** Reduce an HTML string to readable text. Shared by the URL fetch and a saved .html file. */
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function htmlTitle(html) {
  return (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]?.replace(/\s+/g, ' ').trim() || '';
}

/** Fetch a web page and pull the rough text out of it. */
async function fromUrl(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 paper-engine intake' } });
  if (!res.ok) throw new Error(`page fetch returned ${res.status}`);
  const html = await res.text();
  return { text: stripHtml(html), title: htmlTitle(html) };
}

/** Read a page saved to disk (.html/.htm) as if it had been fetched. */
function fromHtml(file) {
  const html = fs.readFileSync(file, 'utf8');
  return { text: stripHtml(html), title: htmlTitle(html) };
}

/** Split one delimited line into fields, honouring "quoted, fields". */
function splitRow(line, delim) {
  const out = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

/**
 * Read a spreadsheet (.csv or .tsv) as a readable transcript: the column names,
 * then one line per row, so the planner sees a table as words, not as punctuation.
 * The delimiter is sniffed from the header row, so a tab- or semicolon-separated
 * file works under the same "csv" type.
 */
function fromCsv(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return { text: '', rows: 0, columns: [] };
  const delim = ['\t', ';', ','].find((d) => lines[0].includes(d)) || ',';
  const columns = splitRow(lines[0], delim).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => splitRow(l, delim));
  const body = rows.map((r, i) => `Row ${i + 1}: ${columns.map((h, j) => `${h}=${r[j] ?? ''}`).join(' | ')}`);
  const text = [`Columns: ${columns.join(', ')}`, ...body].join('\n').trim();
  return { text, rows: rows.length, columns };
}

/**
 * Main entry.
 *   type:  'topic' | 'youtube' | 'url' | 'pdf' | 'docx' | 'txt' | 'md' | 'html' | 'csv'
 *   value: the raw string (a line, or a URL), OR an absolute path for files.
 * For files, pass the path straight through.
 */
export async function intake({ type, value }) {
  if (!type || !String(value || '').trim()) {
    throw new Error('intake needs both a source type and a source.');
  }
  value = String(value).trim();
  let text = '';
  let titleHint = value.slice(0, 120);
  let note = '';

  switch (type) {
    case 'topic':
      text = value;
      note = 'the user described the topic in their own words';
      break;
    case 'youtube': {
      const r = await fromYouTube(value);
      text = r.text || `(no transcript available) ${r.title} — ${r.author}`;
      titleHint = r.title || titleHint;
      note = r.metadataOnly
        ? 'metadata only: the video had no captions, so only its title and description were kept'
        : 'the video’s own transcript';
      break;
    }
    case 'url': {
      const r = await fromUrl(value);
      text = r.text;
      titleHint = r.title || titleHint;
      note = `the web page at ${value}`;
      break;
    }
    case 'pdf': {
      const r = await fromPdf(value);
      text = r.text;
      titleHint = path.basename(value, path.extname(value));
      note = `${r.pages} page(s) of the PDF ${path.basename(value)}`;
      break;
    }
    case 'docx': {
      const r = await fromDocx(value);
      text = r.text;
      titleHint = path.basename(value, path.extname(value));
      note = `the document ${path.basename(value)}`;
      break;
    }
    case 'txt':
    case 'md':
      text = fs.readFileSync(value, 'utf8');
      titleHint = path.basename(value, path.extname(value));
      note = `the file ${path.basename(value)}`;
      break;
    case 'html':
    case 'htm': {
      const r = fromHtml(value);
      text = r.text;
      titleHint = r.title || path.basename(value, path.extname(value));
      note = `the web page saved as ${path.basename(value)}`;
      break;
    }
    case 'csv': {
      const r = fromCsv(value);
      text = r.text;
      titleHint = path.basename(value, path.extname(value));
      note = `${r.columns.length} column(s) and ${r.rows} row(s) of ${path.basename(value)}`;
      break;
    }
    default:
      throw new Error(`unknown source type "${type}". Known: topic, youtube, url, pdf, docx, txt, md, html, csv.`);
  }

  let truncated = false;
  if (text.length > LIMIT_CHARS) {
    text = text.slice(0, LIMIT_CHARS);
    truncated = true;
  }
  return { text, titleHint, note: truncated ? `${note} (truncated at ${LIMIT_CHARS} characters)` : note, truncated };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const [, , type, value] = process.argv;
  intake({ type, value })
    .then((r) => {
      console.log(`titleHint: ${r.titleHint}\nnote: ${r.note}\nlength: ${r.text.length}${r.truncated ? ' (truncated)' : ''}`);
      console.log('\n--- first 2000 chars ---\n');
      console.log(r.text.slice(0, 2000));
    })
    .catch((e) => { console.error(e.message); process.exit(1); });
}