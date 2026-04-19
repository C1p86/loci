/**
 * packages/server/src/routes/hooks/scrub.ts
 * Plan 12-03 Task 1 — header scrubbing before DLQ persist.
 *
 * D-25 deny-list: sensitive header names stripped case-insensitively before DLQ persist.
 * D-26: no body scrub in Phase 12 — payload passes through unchanged.
 */

/**
 * D-25 deny-list of sensitive header names. ALL case-insensitive.
 * Node's http module lowercases incoming header keys, but to be safe we also
 * lowercase at check-time in scrubHeaders.
 */
export const SENSITIVE_HEADER_DENYLIST: readonly string[] = [
  'authorization',
  'x-hub-signature',
  'x-hub-signature-256',
  'x-github-token',
  'x-xci-token',
  'cookie',
  'set-cookie',
];

const denyset = new Set(SENSITIVE_HEADER_DENYLIST);

/**
 * Remove all deny-listed header names from the input dict.
 * Case-insensitive: 'X-Hub-Signature-256' and 'x-hub-signature-256' both stripped.
 * Returns a NEW object — does not mutate input.
 */
export function scrubHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!denyset.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * D-26: no body scrub in Phase 12 — payload passes through unchanged.
 * Kept as an explicit function so future phases can extend if needed without API churn.
 */
export function scrubBody<T>(body: T): T {
  return body;
}
