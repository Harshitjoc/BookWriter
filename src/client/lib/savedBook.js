/* Which project the cockpit was last on. A reload should land you back where
 * you were, not on whichever slug happens to sort first — so the choice is
 * kept in localStorage, the same way the panel layout is (see useLayout.js).
 *
 * Reading is forgiving on purpose: a stored value can be anything at all (an
 * older build, a hand-edit, a project that has since been deleted), so the
 * caller treats the answer as a hint and falls back to the first book. */

export const SLUG_KEY = 'proofpress.slug';

export function readSlug() {
  if (typeof localStorage === 'undefined') return '';
  try { return localStorage.getItem(SLUG_KEY) || ''; } catch { return ''; }
}

export function saveSlug(slug) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(SLUG_KEY, String(slug || '')); } catch { /* private mode */ }
}
