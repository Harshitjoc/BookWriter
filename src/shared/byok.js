/* ==========================================================================
   byok.js  -  Bring Your Own Key
   --------------------------------------------------------------------------
   The cockpit can hold API keys the user pastes in. This module is the only
   place that turns that into a request: it decides which variable names are
   allowed, strips anything that is not a usable secret, and merges it over
   process.env for one call only.

   Nothing here is a database. Nothing here sends a key anywhere. The keys live
   in the browser (sessionStorage by default, localStorage when the user opts
   in), and travel only to this repo's own server on this machine, inside the
   request body, as often as the user drafts or generates a photo.
   ========================================================================== */

import { PROVIDERS } from '../engine/tools/llm.mjs';

/* Every environment variable the keys tab is allowed to fill in. Anything else
   in a request body is ignored rather than passed along, because a tool that
   forwards arbitrary variables is a quieter kind of leak than a file. */
export const KEY_NAMES = [
  ...new Set(
    Object.values(PROVIDERS)
      .map((p) => p.key)
      .filter(Boolean),
  ),
];

/* Google accepts either name on both the draft path (Gemini provider) and the
   image path (gen-image.mjs), so both are in the list. */
if (!KEY_NAMES.includes('GEMINI_API_KEY')) KEY_NAMES.push('GEMINI_API_KEY');
if (!KEY_NAMES.includes('GOOGLE_API_KEY')) KEY_NAMES.push('GOOGLE_API_KEY');

/* One human-sized sanity pass. A key with a line break, a shell history line
   by accident, or a quoted value is not a key, and failing quietly is how you
   get a confusing 401 an hour later. */
export function sanitizeKeys(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const name of KEY_NAMES) {
    const raw = input[name];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value || value.length > 512 || /[\r\n]/.test(value)) continue;
    out[name] = value;
  }
  return out;
}

/* The cockpit key wins for this one request; .env remains the fallback. A call
   to every provider in the registry (and to gen-image.mjs) does not know which
   side the key came from, which is exactly the point of env-style injection. */
export function mergeEnv(baseEnv, keys) {
  return { ...(baseEnv && typeof baseEnv === 'object' ? baseEnv : {}), ...sanitizeKeys(keys) };
}

/* ------------------------------------------------------------------ storage */

const LS = 'byokKeys';
const SS = 'byokSessionKeys';

const hasStorage = () => {
  try {
    return typeof window !== 'undefined'
      && !!window.localStorage
      && !!window.sessionStorage;
  } catch { return false; }
};

/* Load what the user has typed before. Session wins over local, because a
   session value is the one they chose to keep out of the persistent store;
   that is the more defensible answer when the two disagree. */
export function loadKeys() {
  if (!hasStorage()) return {};
  try {
    const session = JSON.parse(window.sessionStorage.getItem(SS) || '{}');
    if (session && typeof session === 'object' && Object.keys(session).length) {
      return sanitizeKeys(session);
    }
  } catch { /* fall through to the persistent store */ }
  try {
    const local = JSON.parse(window.localStorage.getItem(LS) || '{}');
    return sanitizeKeys(local);
  } catch { return {}; }
}

/* Persist. "Remember in this browser" writes localStorage; otherwise the
   keys live only for this tab's session. Either way the other slot is cleared
   first, so there is never two copies to wonder about. */
export function saveKeys(values, remember) {
  if (!hasStorage()) return;
  const clean = sanitizeKeys(values);
  try {
    if (remember) {
      window.localStorage.setItem(LS, JSON.stringify(clean));
      window.sessionStorage.removeItem(SS);
    } else {
      window.sessionStorage.setItem(SS, JSON.stringify(clean));
      window.localStorage.removeItem(LS);
    }
  } catch { /* a full or private store means keys simply do not persist */ }
}

export function clearKeys() {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(LS);
    window.sessionStorage.removeItem(SS);
  } catch { /* nothing to do */ }
}

/* Show enough to recognise a key, not enough to reuse it. This is rendered in
   the UI, so it is allowed to be a dim placeholder rather than a value. */
export function maskKey(v) {
  if (!v) return '';
  const head = v.slice(0, 3);
  const tail = v.length > 6 ? v.slice(-2) : '';
  return `${head}…${tail || '••'}`;
}