#!/usr/bin/env node
/**
 * motion.mjs — the allowlist of motion packs a book can ask for.
 *
 * A book opts into motion by naming packs in book.json "motion": ["fade","draw"].
 * The packs themselves are defined in src/engine/motion/packs.json, and the CSS
 * and runtime live beside it. This module is the one place that
 *   - knows which ids are real (so an unknown id fails the build, not silently),
 *   - normalises the many shapes a book.json may use (a string, a list, a
 *     comma list),
 *   - tells the builder what to inject, and
 *   - tells the cockpit what to offer.
 *
 * There is no directory scan: a stray file in motion/ is not a pack.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..', '..');
export const MOTION_DIR = path.resolve(HERE, '..', 'motion');

const PACKS = JSON.parse(fs.readFileSync(path.join(MOTION_DIR, 'packs.json'), 'utf8'));

/** The pack ids this engine actually has, in the order the picker shows them. */
export const PACK_IDS = Object.keys(PACKS).filter((k) => !k.startsWith('$'));

export const MOTION_CSS = 'motion.css';
export const MOTION_JS = 'motion.js';

/** Normalise whatever a book.json wrote into a clean, de-duped, known-id list.
 *  Accepts: null, "fade", ["fade","draw"], "fade,draw", and mixed arrays.
 *  Throws on an id that is not a real pack, so a typo is caught at build time. */
export function normalizePacks(value) {
  if (value == null || value === false || value === '') return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const out = [];
  for (const item of raw) {
    for (const piece of String(item).split(',')) {
      const id = piece.trim().toLowerCase();
      if (!id) continue;
      if (!PACK_IDS.includes(id)) {
        throw new Error(`unknown motion pack "${id}". Known: ${PACK_IDS.join(', ')}`);
      }
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** Every motion pack the picker may offer, in catalog order. */
export function listMotion() {
  return PACK_IDS.map((id) => ({ id, label: PACKS[id].label, note: PACKS[id].note }));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  for (const p of listMotion()) console.log(`  ${p.id.padEnd(12)} ${p.label} — ${p.note}`);
}
