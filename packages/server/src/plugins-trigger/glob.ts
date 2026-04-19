/**
 * Hand-rolled `*` wildcard glob matcher.
 * D-36 (Claude's discretion): picomatch or hand-rolled for `*` wildcards since patterns are simple.
 *
 * Rules:
 * - `*` matches one or more characters (greedy, matches any char including `/` for Perforce depot compat).
 * - Other regex metacharacters in the pattern are literal-escaped.
 * - An empty pattern matches only an empty string.
 * - Exact literals are compared as-is (no case folding).
 *
 * D-10 glob matching:
 * - 'acme/*' matches 'acme/infra'
 * - 'main' is literal (exact match)
 * - '*' matches any non-empty string
 *
 * Security note (T-12-02-04): translated regex uses `.+` (one-or-more non-nested quantifier)
 * for each `*` segment. Pattern is split on `*` first then joined — no nested quantifiers,
 * no catastrophic backtracking possible.
 */
export function matchGlob(pattern: string, value: string): boolean {
  if (pattern === '') {
    return value === '';
  }
  // Escape all regex metacharacters EXCEPT '*', which we translate to '.+'
  const re =
    '^' +
    pattern
      .split('*')
      .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.+') +
    '$';
  return new RegExp(re).test(value);
}
