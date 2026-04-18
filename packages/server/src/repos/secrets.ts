import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { decryptSecret, encryptSecret, getOrCreateOrgDek } from '../crypto/secrets.js';
import { generateId } from '../crypto/tokens.js';
import { type NewSecret, secrets } from '../db/schema.js';
import { DatabaseError, SecretNameConflictError, SecretNotFoundError } from '../errors.js';
import { writeSecretAuditEntry } from './secret-audit-log.js';

/**
 * D-29 / D-16: Org-scoped repo for encrypted secret values.
 * Encryption is embedded within this repo (D-18) — callers never touch raw crypto.
 *
 * SECURITY INVARIANT:
 * - list() and getById() return METADATA ONLY — never ciphertext, iv, tag, aad, or plaintext.
 * - resolveByName() is the ONLY method that returns plaintext. It is called exclusively
 *   by Phase 10 dispatch; no Phase 9 route handler calls it.
 * - No log statements anywhere in this file may reference value, plaintext, ciphertext,
 *   iv, tag, dek, or mek (SEC-03 / D-10 discipline).
 *
 * Never exported from repos/index.ts (D-01 discipline).
 */
export function makeSecretsRepo(db: PostgresJsDatabase, orgId: string, mek: Buffer) {
  return {
    /**
     * List secrets for this org — METADATA ONLY.
     * Never returns ciphertext, iv, authTag, aad, or plaintext value.
     */
    async list() {
      return db
        .select({
          id: secrets.id,
          name: secrets.name,
          createdAt: secrets.createdAt,
          updatedAt: secrets.updatedAt,
          lastUsedAt: secrets.lastUsedAt,
        })
        .from(secrets)
        .where(eq(secrets.orgId, orgId));
    },

    /**
     * Get a single secret by ID — METADATA ONLY.
     * Returns undefined if not found or not in this org.
     */
    async getById(secretId: string) {
      const rows = await db
        .select({
          id: secrets.id,
          name: secrets.name,
          createdAt: secrets.createdAt,
          updatedAt: secrets.updatedAt,
          lastUsedAt: secrets.lastUsedAt,
        })
        .from(secrets)
        .where(and(eq(secrets.orgId, orgId), eq(secrets.id, secretId)))
        .limit(1);
      return rows[0];
    },

    /**
     * Create a new secret. Encrypts value under this org's DEK (get-or-create).
     * Writes secret row AND audit log entry in a SINGLE transaction (D-22).
     * Catches PG 23505 (secrets_org_name_unique) -> SecretNameConflictError.
     * Returns { id, name }.
     */
    async create(params: {
      name: string;
      value: string;
      createdByUserId: string;
    }): Promise<{ id: string; name: string }> {
      const id = generateId('sec');
      let resultId = id;
      let resultName = params.name;

      await db.transaction(async (tx) => {
        // biome-ignore lint/suspicious/noExplicitAny: tx satisfies the same query interface
        const dek = await getOrCreateOrgDek(tx as unknown as PostgresJsDatabase<any>, orgId, mek);
        const aad = `${orgId}:${params.name}`;
        const { ciphertext, iv, tag } = encryptSecret(dek, params.value, aad);

        const payload = {
          id,
          orgId,
          name: params.name,
          ciphertext,
          iv,
          authTag: tag,
          aad,
          createdByUserId: params.createdByUserId,
        } satisfies NewSecret;

        try {
          await tx.insert(secrets).values(payload);
        } catch (err) {
          const pgCode =
            (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
          if (pgCode === '23505') {
            throw new SecretNameConflictError();
          }
          throw new DatabaseError('secrets.create failed', err);
        }

        await writeSecretAuditEntry(
          // biome-ignore lint/suspicious/noExplicitAny: tx satisfies the same query interface
          tx as unknown as PostgresJsDatabase<any>,
          {
            orgId,
            secretId: id,
            secretName: params.name,
            action: 'create',
            actorUserId: params.createdByUserId,
          },
        );

        resultId = id;
        resultName = params.name;
      });

      return { id: resultId, name: resultName };
    },

    /**
     * Update a secret's value (name is immutable per D-19 / Pitfall 3).
     * Re-encrypts with a NEW random IV (SEC-02).
     * Writes audit log entry in the SAME transaction (D-22).
     * Throws SecretNotFoundError if not found in this org.
     */
    async update(secretId: string, params: { value: string; actorUserId: string }): Promise<void> {
      await db.transaction(async (tx) => {
        // Look up the existing name for AAD reconstruction (D-19: name is immutable)
        const rows = await tx
          .select({ name: secrets.name })
          .from(secrets)
          .where(and(eq(secrets.orgId, orgId), eq(secrets.id, secretId)))
          .limit(1);

        const existing = rows[0];
        if (existing === undefined) {
          throw new SecretNotFoundError();
        }

        // biome-ignore lint/suspicious/noExplicitAny: tx satisfies the same query interface
        const dek = await getOrCreateOrgDek(tx as unknown as PostgresJsDatabase<any>, orgId, mek);
        // Rebuild AAD from stored name — this must match what was set at create time
        const aad = `${orgId}:${existing.name}`;
        const { ciphertext, iv, tag } = encryptSecret(dek, params.value, aad);

        await tx
          .update(secrets)
          .set({ ciphertext, iv, authTag: tag, updatedAt: sql`now()` })
          .where(and(eq(secrets.orgId, orgId), eq(secrets.id, secretId)));

        await writeSecretAuditEntry(
          // biome-ignore lint/suspicious/noExplicitAny: tx satisfies the same query interface
          tx as unknown as PostgresJsDatabase<any>,
          {
            orgId,
            secretId,
            secretName: existing.name,
            action: 'update',
            actorUserId: params.actorUserId,
          },
        );
      });
    },

    /**
     * Delete a secret. Writes tombstone audit entry (secretId=null, secretName preserved)
     * in the SAME transaction (D-22 + D-21 nullable secretId).
     * Throws SecretNotFoundError if not found in this org.
     */
    async delete(secretId: string, actorUserId: string): Promise<void> {
      await db.transaction(async (tx) => {
        // Get the name first (needed for tombstone audit entry)
        const rows = await tx
          .select({ name: secrets.name })
          .from(secrets)
          .where(and(eq(secrets.orgId, orgId), eq(secrets.id, secretId)))
          .limit(1);

        const existing = rows[0];
        if (existing === undefined) {
          throw new SecretNotFoundError();
        }

        await tx.delete(secrets).where(and(eq(secrets.orgId, orgId), eq(secrets.id, secretId)));

        // D-21 tombstone: secretId is NULL because the row is gone; secretName is preserved
        await writeSecretAuditEntry(
          // biome-ignore lint/suspicious/noExplicitAny: tx satisfies the same query interface
          tx as unknown as PostgresJsDatabase<any>,
          {
            orgId,
            secretId: null,
            secretName: existing.name,
            action: 'delete',
            actorUserId,
          },
        );
      });
    },

    /**
     * Resolve a secret by name — the SOLE plaintext-producing path in the codebase.
     * Used exclusively by Phase 10 dispatch. NO Phase 9 route handler calls this.
     *
     * Steps:
     * 1. Look up ciphertext + iv + authTag + aad for this org+name.
     * 2. Get/create org DEK, decrypt plaintext.
     * 3. In a transaction: update lastUsedAt + write 'resolve' audit entry.
     * 4. Return plaintext string.
     *
     * Throws SecretNotFoundError if not found.
     * Throws SecretDecryptError on auth tag mismatch (corrupt/tampered data).
     */
    async resolveByName(name: string, actorUserId: string): Promise<string> {
      // Step 1: Fetch the full encrypted row
      const rows = await db
        .select({
          id: secrets.id,
          ciphertext: secrets.ciphertext,
          iv: secrets.iv,
          authTag: secrets.authTag,
          aad: secrets.aad,
        })
        .from(secrets)
        .where(and(eq(secrets.orgId, orgId), eq(secrets.name, name)))
        .limit(1);

      const row = rows[0];
      if (row === undefined) {
        throw new SecretNotFoundError();
      }

      // Step 2: Decrypt outside transaction (read-only crypto operation)
      const dek = await getOrCreateOrgDek(db, orgId, mek);
      // decryptSecret throws SecretDecryptError on tag mismatch — zero-arg, no crypto material
      const plaintext = decryptSecret(dek, row.ciphertext, row.iv, row.authTag, row.aad);

      // Step 3: Update lastUsedAt + write 'resolve' audit entry atomically
      await db.transaction(async (tx) => {
        await tx
          .update(secrets)
          .set({ lastUsedAt: sql`now()` })
          .where(and(eq(secrets.orgId, orgId), eq(secrets.id, row.id)));

        await writeSecretAuditEntry(
          // biome-ignore lint/suspicious/noExplicitAny: tx satisfies the same query interface
          tx as unknown as PostgresJsDatabase<any>,
          {
            orgId,
            secretId: row.id,
            secretName: name,
            action: 'resolve',
            actorUserId,
          },
        );
      });

      return plaintext;
    },
  };
}

export type SecretsRepo = ReturnType<typeof makeSecretsRepo>;
