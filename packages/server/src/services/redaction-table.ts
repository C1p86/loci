// Phase 11 D-05/D-06/D-07: per-run redaction table + redactChunk pure helper.
// Built at dispatch time with decrypted org-secret values; cleared when run reaches terminal state.
// NEVER log the table contents (D-10 discipline — secrets must not appear in logs).

import type { FastifyInstance } from 'fastify';

const MIN_REDACT_LEN = 4;

/**
 * Compute all redaction variants for a single secret value.
 * Returns [] if value.length < MIN_REDACT_LEN.
 * Variants: raw + base64 + base64-utf8 (defensive duplicate) + URL-encoded + hex.
 * Each variant is also filtered to MIN_REDACT_LEN after transformation (edge-case defense).
 */
export function buildRedactionVariants(value: string): string[] {
  if (value.length < MIN_REDACT_LEN) return [];
  const variants = new Set<string>();
  variants.add(value);
  try {
    variants.add(Buffer.from(value).toString('base64'));
  } catch {
    /* non-utf8 value — skip */
  }
  try {
    variants.add(Buffer.from(value, 'utf8').toString('base64'));
  } catch {
    /* skip */
  }
  try {
    variants.add(encodeURIComponent(value));
  } catch {
    /* skip */
  }
  try {
    variants.add(Buffer.from(value).toString('hex'));
  } catch {
    /* skip */
  }
  // Strip any variant that fell below MIN_REDACT_LEN after transformation (defensive)
  return [...variants].filter((v) => v.length >= MIN_REDACT_LEN);
}

/**
 * Build a per-run redaction table from decrypted org secret values.
 * D-05: called synchronously at dispatch time (trigger.ts) BEFORE enqueue.
 * D-06: variants are sorted LONGEST-FIRST to prevent partial replacements.
 * D-05: values shorter than 4 chars are skipped (avoids replacing common words).
 *
 * The table is stored as a frozen array on fastify.runRedactionTables[runId].
 * NEVER log the table contents or the input secretValues.
 */
export function buildRedactionTable(
  fastify: FastifyInstance,
  runId: string,
  secretValues: readonly string[],
): void {
  const combined = new Set<string>();
  for (const v of secretValues) {
    for (const variant of buildRedactionVariants(v)) {
      combined.add(variant);
    }
  }
  // D-06: longest-first ordering prevents "abcd" matching before "abcd1234efgh"
  const ordered = [...combined].sort((a, b) => b.length - a.length);
  fastify.runRedactionTables.set(runId, Object.freeze(ordered));
}

/**
 * Remove the per-run redaction table when the run reaches terminal state.
 * D-05: cleared by handleResultFrame in ws/handler.ts.
 * No-op if the entry is already absent (idempotent).
 */
export function clearRedactionTable(fastify: FastifyInstance, runId: string): void {
  fastify.runRedactionTables.delete(runId);
}

/**
 * Apply server-side redaction to a single chunk's data string.
 * D-07: if redactions is undefined (table missing — run is terminal or never seeded),
 * returns data unchanged. This is safe: Phase 9 architectural invariant (no plaintext
 * secrets in API responses) is the primary control; redaction is defense-in-depth.
 *
 * Applies replaceAll in the order given (MUST be longest-first — see buildRedactionTable).
 */
export function redactChunk(
  data: string,
  redactions: readonly string[] | undefined,
): string {
  if (!redactions || redactions.length === 0) return data;
  let out = data;
  for (const value of redactions) {
    out = out.replaceAll(value, '***');
  }
  return out;
}
