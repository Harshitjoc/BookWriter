#!/usr/bin/env node
/**
 * templates.mjs — the allowlist of scaffolds a new book can be copied from.
 *
 * The engine used to have exactly one scaffold, books/starter, hard-coded in
 * the server, in make-book.mjs and in the tests. A book is now chosen from a
 * small, explicit catalog: the default explainer (books/starter, first) plus the
 * named templates under templates/<id>/. There is no directory scan, because a
 * scan would silently offer any stray folder a person happened to leave behind.
 *
 * Every entry points at a folder that is a complete, buildable book: book.json,
 * an interior named <id>.html, VOICE.md, blocks.md, optionally images/. The
 * cockpit reads the display metadata here; the server copies the folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..', '..');

/* The allowlist, in the order the picker shows it. `meta` is the fallback used
   when a folder has no template.json; if it does, the file wins. The first
   entry is the default every bare new-book gets. */
const CATALOG = [
  {
    id: 'starter', dir: 'books/starter', isDefault: true,
    meta: {
      name: 'Explainer',
      blurb: 'Technical, one idea per page. The default scaffold, and the shape every other template still obeys.',
      theme: 'studio', size: 'b5', archetype: 'standard',
      voice: 'plain and precise; states one mechanism, shows it, then gives one action.',
      tags: ['technical', 'default'],
    },
  },
  { id: 'cookbook', dir: 'templates/cookbook' },
  { id: 'manual', dir: 'templates/manual' },
  { id: 'reference', dir: 'templates/reference' },
  { id: 'field-guide', dir: 'templates/field-guide' },
  { id: 'memoir', dir: 'templates/memoir' },
];

export const DEFAULT_TEMPLATE_ID = CATALOG.find((t) => t.isDefault)?.id || CATALOG[0].id;

function readMeta(dir) {
  for (const name of ['template.json', 'book.json']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      return j;
    } catch { /* try the next, then give up */ }
  }
  return {};
}

/** Resolve one template id to its folder on disk, or null if it is not known. */
export function templateDir(id, root = ROOT) {
  const t = CATALOG.find((x) => x.id === id);
  return t ? path.join(root, t.dir) : null;
}

/** One template's full record: id, absolute folder, and display metadata. */
export function templateById(id, root = ROOT) {
  const t = CATALOG.find((x) => x.id === id);
  if (!t) return null;
  const dir = path.join(root, t.dir);
  const disk = readMeta(dir);
  return {
    id: t.id,
    dir,
    relDir: t.dir,
    isDefault: !!t.isDefault,
    exists: fs.existsSync(dir),
    name: disk.name || t.meta?.name || disk.title || t.id,
    blurb: disk.blurb || t.meta?.blurb || disk.subtitle || '',
    theme: disk.theme || t.meta?.theme || 'studio',
    size: disk.size || t.meta?.size || 'b5',
    archetype: disk.archetype || t.meta?.archetype || 'standard',
    voice: disk.voice || t.meta?.voice || '',
    tags: disk.tags || t.meta?.tags || [],
  };
}

/** Every template the picker may offer, in catalog order. */
export function listTemplates(root = ROOT) {
  return CATALOG.map((t) => templateById(t.id, root));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  for (const t of listTemplates()) {
    console.log(`${t.isDefault ? '*' : ' '} ${t.id.padEnd(12)} ${t.theme}/${t.size}  ${t.name}${t.exists ? '' : '  (MISSING)'}`);
  }
}
