import { randomBytes } from 'node:crypto';

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
  prefix: 'org' | 'usr' | 'mem' | 'ses' | 'inv' | 'ver' | 'pwr' | 'plan',
): string {
  return `xci_${prefix}_${randomBytes(15).toString('base64url')}`;
}
