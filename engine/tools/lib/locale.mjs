/* ==========================================================================
   lib/locale.mjs  -  language and direction, in one place
   --------------------------------------------------------------------------
   A book may declare a "lang" (a BCP-47 tag) and, less often, a "dir". Every
   tool that needs to know the direction reads it from here rather than keeping
   its own list, so the day a language is added it is added once.

   The default language is English and the default direction is derived from it,
   so a book that says nothing is LTR English and its build is byte-identical to
   what it always was. Nothing in this file runs unless a book opts in.
   ========================================================================== */

/* Languages written right to left. Compared on the primary subtag, so
   "ar-EG" and "he" both resolve to rtl. Kept as the primary tags, not a full
   CLDR import: the point is the direction of the script, and these are the
   written-RTL languages a book is realistically authored in. */
export const RTL_LANGS = new Set([
  'ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'iw', 'khw', 'ks', 'ku', 'nqo',
  'ps', 'sd', 'syr', 'ug', 'ur', 'yi',
]);

const VALID_LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

/** A trimmed BCP-47 tag, or null when there is nothing usable. Throws on
 *  something that is present but malformed, so a typo is loud at build time. */
export function normalizeLang(lang) {
  if (lang == null) return null;
  const s = String(lang).trim();
  if (!s) return null;
  if (!VALID_LANG.test(s)) {
    throw new Error(`bad "lang" "${s}". Use a BCP-47 tag such as "en", "fr", "ar" or "zh-Hans".`);
  }
  return s;
}

/** The direction a language is written in: 'rtl' or 'ltr'. */
export function dirForLang(lang) {
  const s = normalizeLang(lang);
  if (!s) return 'ltr';
  return RTL_LANGS.has(s.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr';
}

/** The direction for a book object. An explicit "dir" wins, then the language,
 *  then null (meaning: change nothing, the head is left exactly as written).
 *  'auto' is accepted and means "let the browser decide per run", which is what
 *  a mixed-language book wants; it is passed through to <html dir="auto">. */
export function resolveDirection(book = {}) {
  const explicit = book.dir == null ? '' : String(book.dir).trim().toLowerCase();
  if (explicit) {
    if (!['ltr', 'rtl', 'auto'].includes(explicit)) {
      throw new Error(`bad "dir" "${book.dir}". Use "ltr", "rtl" or "auto".`);
    }
    return explicit;
  }
  if (book.lang) return dirForLang(book.lang);
  return null;
}

/** Whether a book asks for any language work at all. When false, every tool
 *  takes the untouched path and the committed books stay byte-identical. */
export function hasLocale(book = {}) {
  return Boolean((book.lang && String(book.lang).trim()) || (book.dir && String(book.dir).trim()));
}
