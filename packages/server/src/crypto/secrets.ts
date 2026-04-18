// crypto/secrets.ts
//
// Phase 9 D-17/D-18. AES-256-GCM envelope encryption.
// NEVER log the values returned by decryptSecret or unwrapDek.
// Buffers held as locals should go out of scope as quickly as possible.
//
// Call order (RESEARCH §FA-2 / Pitfall 1 — VERIFIED on Node 22):
//   Encrypt: createCipheriv → setAAD → update → final → getAuthTag
//   Decrypt: createDecipheriv → setAAD → setAuthTag → update → final
//   setAuthTag MUST precede update/final on the decipher; Node throws TypeError otherwise.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { orgDeks } from '../db/schema.js';
import { SecretDecryptError } from '../errors.js';

// DEK wrap AAD constant — avoids magic strings; no per-call AAD needed for DEK wrapping
// since org binding comes from the org_deks.org_id column (D-16 notes).
const DEK_WRAP_AAD = Buffer.from('dek-wrap', 'utf8');

/**
 * Encrypt a plaintext string under `dek` using AES-256-GCM.
 * AAD binds the ciphertext to its storage location (`${orgId}:${name}` per D-16).
 * iv is 12 random bytes per call (NIST SP 800-38D §8.2.1 + SEC-02).
 */
export function encryptSecret(
  dek: Buffer,
  plaintext: string,
  aad: string,
): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12); // SEC-02: random 96-bit IV per call
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8')); // D-16 location binding
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes (128-bit tag by default)
  return { ciphertext, iv, tag };
}

/**
 * Decrypt a ciphertext under `dek` using AES-256-GCM.
 * Throws SecretDecryptError on any auth failure — never leaks tag/iv/ciphertext in error (SEC-03).
 *
 * CRITICAL call order (Pitfall 1): setAuthTag MUST precede update/final.
 */
export function decryptSecret(
  dek: Buffer,
  ciphertext: Buffer,
  iv: Buffer,
  tag: Buffer,
  aad: string,
): string {
  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag); // Pitfall 1: MUST precede update/final
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Node throws 'Unsupported state or unable to authenticate data' on tag mismatch.
    // Re-throw as SecretDecryptError — no plaintext/tag/iv/ciphertext leaked (SEC-03 / D-10).
    throw new SecretDecryptError();
  }
}

/**
 * Wrap a DEK under the MEK using AES-256-GCM.
 * Uses constant DEK_WRAP_AAD (no per-call AAD; org binding comes from org_deks.org_id).
 * iv is 12 random bytes per call (SEC-02).
 */
export function wrapDek(
  mek: Buffer,
  dek: Buffer,
): { wrapped: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12); // SEC-02: random IV per wrap call
  const cipher = createCipheriv('aes-256-gcm', mek, iv);
  cipher.setAAD(DEK_WRAP_AAD);
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { wrapped, iv, tag };
}

/**
 * Unwrap a wrapped DEK using the MEK.
 * Returns the plaintext DEK as a Buffer.
 * Throws SecretDecryptError on any auth failure (same discipline as decryptSecret).
 */
export function unwrapDek(mek: Buffer, wrapped: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', mek, iv);
  decipher.setAAD(DEK_WRAP_AAD);
  decipher.setAuthTag(tag); // Pitfall 1: MUST precede update/final
  try {
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  } catch {
    throw new SecretDecryptError();
  }
}

/**
 * Idempotent get-or-create for an org's DEK (D-15).
 * If a wrapped DEK row exists for `orgId`, unwrap and return it.
 * Otherwise generate a new 32-byte DEK, wrap it under `mek`, insert the row, and return the DEK.
 *
 * Accepts either a db handle or a transaction handle as the first arg
 * (PostgresJsDatabase covers both via the shared query interface).
 * Plan 09-03's makeSecretsRepo will pass `tx` inside a Drizzle transaction.
 */
export async function getOrCreateOrgDek(
  // biome-ignore lint/suspicious/noExplicitAny: PostgresJsDatabase schema type is unknown at this layer
  db: PostgresJsDatabase<any>,
  orgId: string,
  mek: Buffer,
): Promise<Buffer> {
  const rows = await db.select().from(orgDeks).where(eq(orgDeks.orgId, orgId)).limit(1);

  if (rows.length > 0) {
    const row = rows[0]!;
    return unwrapDek(mek, row.wrappedDek, row.wrapIv, row.wrapTag);
  }

  // First secret for this org — generate a fresh DEK and store it wrapped
  const dek = randomBytes(32);
  const { wrapped, iv, tag } = wrapDek(mek, dek);

  await db.insert(orgDeks).values({
    orgId,
    wrappedDek: wrapped,
    wrapIv: iv,
    wrapTag: tag,
    mekVersion: 1,
  });

  return dek;
}
