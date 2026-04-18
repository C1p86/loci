import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 256-bit opaque token — used for session IDs, email-verification tokens,
 * password-reset tokens, and org-invite tokens (D-33).
 * Never log the return value.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * xci_<prefix>_<base64url-rand15>  — 120-bit entropy, URL-safe (D-25).
 * 15 bytes → 20 base64url chars; total length ~28 chars for "xci_usr_..."
 */
export function generateId(
  prefix:
    | 'org'
    | 'usr'
    | 'mem'
    | 'ses'
    | 'inv'
    | 'ver'
    | 'pwr'
    | 'plan'
    | 'agt'
    | 'crd'
    | 'rtk'
    | 'tsk'
    | 'sec'
    | 'sal',
): string {
  return `xci_${prefix}_${randomBytes(15).toString('base64url')}`;
}

/**
 * One-way sha256 hash for at-rest storage of agent credentials and registration tokens.
 * Input: plaintext base64url token string. Output: lowercase hex digest (64 chars).
 * D-11 / ATOK-06. NEVER log the input.
 */
export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * Timing-safe token comparison. Both arguments are compared as UTF-8 byte buffers.
 * Returns false immediately if lengths differ — this leak is acceptable because the
 * attacker knows the expected length (all tokens are randomBytes(32) = 43 base64url chars,
 * or sha256 hex = 64 chars). Pitfall 3: timingSafeEqual THROWS on unequal lengths, so we
 * must pre-check.
 * ATOK-06: every token/credential comparison in server code MUST go through this helper.
 */
export function compareToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}
