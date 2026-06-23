// src/executor/nesting.ts
//
// Single chokepoint for reading XCI_NESTING_DEPTH and XCI_BREADCRUMB from the environment.
// All code that needs to know whether xci is running as a nested delegate
// MUST use these helpers — never read process.env directly.

export const XCI_NESTING_DEPTH_ENV = 'XCI_NESTING_DEPTH';

/**
 * Environment variable name that carries the accumulated breadcrumb path
 * from an outer xci instance into a delegated (inner) xci process.
 * Value format: alias segments joined by ' > ', e.g. 'outerAlias > innerAlias'.
 * Absent (no delegation) → behaves as if empty → getBreadcrumbPrefix() returns [].
 */
export const XCI_BREADCRUMB_ENV = 'XCI_BREADCRUMB';

/**
 * Read the current nesting depth from the environment.
 * Parses process.env.XCI_NESTING_DEPTH:
 *   - Absent / empty → 0
 *   - Non-numeric (NaN) → 0
 *   - Negative → clamped to 0
 */
export function getNestingDepth(): number {
  const raw = process.env[XCI_NESTING_DEPTH_ENV];
  if (raw === undefined || raw === '') return 0;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, n);
}

/**
 * Returns true if xci is running as a nested delegate (depth > 0).
 * When nested, output attenuation applies:
 *   - Terminal title OSC sequences are suppressed
 *   - Desktop notifications are suppressed
 *   - Real-time tail cursor-move redraws are disabled
 */
export function isNested(): boolean {
  return getNestingDepth() > 0;
}

/**
 * Read the incoming breadcrumb prefix from the environment.
 * Parses process.env.XCI_BREADCRUMB:
 *   - Absent / empty → []
 *   - 'a > b' → ['a', 'b']
 *   - 'a > b > c' → ['a', 'b', 'c']
 *   - Segments are trimmed; empty segments after trimming are dropped.
 *
 * This helper mirrors getNestingDepth's defensive style: no exceptions,
 * always returns a usable value. A hostile env value can only inject
 * more display segments — no code execution, no path traversal (T-ipz-03).
 *
 * PURE — no imports beyond process.env (cold-start budget: < 300ms).
 */
export function getBreadcrumbPrefix(): string[] {
  const raw = process.env[XCI_BREADCRUMB_ENV];
  if (raw === undefined || raw === '') return [];
  return raw
    .split(' > ')
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0);
}
