/**
 * Strips characters that have special meaning in PostgREST's filter
 * mini-language. User-supplied search text is interpolated into `.or(...)`
 * strings (e.g. `title.ilike.%term%,description.ilike.%term%`), where a comma
 * starts a new OR-condition and parentheses open logical groups — so an
 * unsanitised term like `x,id.eq.<uuid>` would inject extra filters.
 * Removing the separators/grouping chars neutralises that injection while
 * leaving normal text (letters, digits, dots, spaces) intact.
 */
function sanitizeSearchTerm(s) {
  return String(s ?? '')
    .replace(/[(),*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { sanitizeSearchTerm };
