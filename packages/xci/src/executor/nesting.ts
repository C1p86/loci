// src/executor/nesting.ts
//
// Single chokepoint for reading XCI_NESTING_DEPTH from the environment.
// All code that needs to know whether xci is running as a nested delegate
// MUST use these helpers — never read process.env directly.

export const XCI_NESTING_DEPTH_ENV = 'XCI_NESTING_DEPTH';

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
