// packages/server/src/repos/webhook-tokens.ts
// D-04 auto-discovery: covered by webhook-tokens.isolation.test.ts.
// Phase 12 D-28: org-scoped repo for webhook_tokens.
// plugin_secret encrypted with AES-256-GCM via Phase 9 envelope encryption.
// Plaintext token returned ONCE on create; never stored or logged.

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { decryptSecret, encryptSecret, getOrCreateOrgDek } from '../crypto/secrets.js';
import { generateId, generateToken, hashToken } from '../crypto/tokens.js';
import { type NewWebhookToken, webhookTokens } from '../db/schema.js';

/**
 * D-28: Org-scoped repo for webhook_tokens.
 * mek is the master encryption key (from fastify.mek) — used to fetch/create the org DEK
 * for encrypting/decrypting plugin_secret (GitHub HMAC secret).
 *
 * SECURITY INVARIANTS (T-12-01-01, T-12-01-05):
 * - Plaintext token returned ONCE in create(); never stored in DB (sha256 hash stored instead).
 * - No log statement in this file may reference plaintext token or plugin_secret plaintext.
 * - Zero-arg constructor discipline: thrown errors never include plaintext material.
 * - resolvePluginSecret returns Buffer; caller is responsible for not logging it.
 */
export function makeWebhookTokensRepo(db: PostgresJsDatabase, orgId: string, mek: Buffer) {
  return {
    /**
     * List tokens for this org — METADATA ONLY.
     * Never returns tokenHash or plugin_secret columns.
     */
    async list(): Promise<
      Array<{
        id: string;
        orgId: string;
        pluginName: string;
        createdByUserId: string | null;
        createdAt: Date;
        updatedAt: Date;
        revokedAt: Date | null;
        hasPluginSecret: boolean;
      }>
    > {
      const rows = await db
        .select({
          id: webhookTokens.id,
          orgId: webhookTokens.orgId,
          pluginName: webhookTokens.pluginName,
          createdByUserId: webhookTokens.createdByUserId,
          createdAt: webhookTokens.createdAt,
          updatedAt: webhookTokens.updatedAt,
          revokedAt: webhookTokens.revokedAt,
          // Derive hasPluginSecret via IS NOT NULL check — never returns the ciphertext itself.
          hasPluginSecret: sql<boolean>`plugin_secret_encrypted IS NOT NULL`,
        })
        .from(webhookTokens)
        .where(eq(webhookTokens.orgId, orgId));
      return rows.map((r) => ({ ...r, hasPluginSecret: r.hasPluginSecret ?? false }));
    },

    /**
     * Get a single token row by ID, scoped to this org.
     * Returns undefined if not found or belongs to a different org (T-12-01-02).
     * Returns metadata only — no tokenHash or plugin_secret columns.
     */
    async getById(tokenId: string): Promise<
      | {
          id: string;
          orgId: string;
          pluginName: string;
          createdByUserId: string | null;
          createdAt: Date;
          updatedAt: Date;
          revokedAt: Date | null;
        }
      | undefined
    > {
      const rows = await db
        .select({
          id: webhookTokens.id,
          orgId: webhookTokens.orgId,
          pluginName: webhookTokens.pluginName,
          createdByUserId: webhookTokens.createdByUserId,
          createdAt: webhookTokens.createdAt,
          updatedAt: webhookTokens.updatedAt,
          revokedAt: webhookTokens.revokedAt,
        })
        .from(webhookTokens)
        .where(and(eq(webhookTokens.orgId, orgId), eq(webhookTokens.id, tokenId)))
        .limit(1);
      return rows[0];
    },

    /**
     * Create a new webhook token for this org.
     * Generates random plaintext token, stores sha256 hash only.
     * If pluginSecret provided (GitHub HMAC secret), encrypts via org DEK + AAD binding.
     *
     * Returns { id, plaintext, endpointPath } — plaintext returned ONCE, never stored.
     * T-12-01-01: plugin_secret stored as AES-256-GCM ciphertext only.
     * T-12-01-05: plaintext NEVER logged or included in errors.
     */
    async create(params: {
      pluginName: 'github' | 'perforce';
      pluginSecret?: string; // GitHub HMAC secret — NULL for Perforce
      createdByUserId?: string;
    }): Promise<{ id: string; plaintext: string; endpointPath: string }> {
      const id = generateId('whk');
      const plaintext = generateToken();
      const tokenHash = hashToken(plaintext);

      let pluginSecretEncrypted: Buffer | null = null;
      let pluginSecretIv: Buffer | null = null;
      let pluginSecretTag: Buffer | null = null;

      if (params.pluginSecret !== undefined && params.pluginSecret.length > 0) {
        // T-12-01-01: fetch org DEK, encrypt with AAD = `${orgId}:webhook:${id}`.
        const dek = await getOrCreateOrgDek(db, orgId, mek);
        const aad = `${orgId}:webhook:${id}`;
        const { ciphertext, iv, tag } = encryptSecret(dek, params.pluginSecret, aad);
        pluginSecretEncrypted = ciphertext;
        pluginSecretIv = iv;
        pluginSecretTag = tag;
      }

      const payload = {
        id,
        orgId,
        pluginName: params.pluginName,
        tokenHash,
        pluginSecretEncrypted,
        pluginSecretIv,
        pluginSecretTag,
        createdByUserId: params.createdByUserId ?? null,
      } satisfies NewWebhookToken;

      await db.insert(webhookTokens).values(payload);

      return {
        id,
        plaintext,
        endpointPath: `/hooks/${params.pluginName}/${plaintext}`,
      };
    },

    /**
     * Decrypt and return the plugin_secret for the given active token.
     * Returns null if the token has no plugin_secret (Perforce — no HMAC).
     * Returns undefined if the token does not exist in this org or is revoked.
     * T-12-01-01: dek is fetched inline; plaintext secret exists only within this function's scope.
     */
    async resolvePluginSecret(tokenId: string): Promise<Buffer | null | undefined> {
      const rows = await db
        .select({
          pluginSecretEncrypted: webhookTokens.pluginSecretEncrypted,
          pluginSecretIv: webhookTokens.pluginSecretIv,
          pluginSecretTag: webhookTokens.pluginSecretTag,
        })
        .from(webhookTokens)
        .where(
          and(
            eq(webhookTokens.orgId, orgId),
            eq(webhookTokens.id, tokenId),
            isNull(webhookTokens.revokedAt),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) return undefined; // not found or revoked

      if (row.pluginSecretEncrypted === null || row.pluginSecretEncrypted === undefined) {
        return null; // Perforce — no HMAC secret
      }

      const dek = await getOrCreateOrgDek(db, orgId, mek);
      const aad = `${orgId}:webhook:${tokenId}`;
      const plaintext = decryptSecret(
        dek,
        row.pluginSecretEncrypted,
        row.pluginSecretIv as Buffer,
        row.pluginSecretTag as Buffer,
        aad,
      );
      return Buffer.from(plaintext, 'utf8');
    },

    /**
     * Revoke a token (sets revokedAt = now()), scoped to this org.
     * Idempotent: if already revoked, the UPDATE touches 0 rows.
     */
    async revoke(tokenId: string): Promise<void> {
      await db
        .update(webhookTokens)
        .set({ revokedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(webhookTokens.orgId, orgId), eq(webhookTokens.id, tokenId)));
    },

    /**
     * Hard-delete a token row, scoped to this org.
     * Owner-only operation (enforced at route level per D-29).
     */
    async delete(tokenId: string): Promise<void> {
      await db
        .delete(webhookTokens)
        .where(and(eq(webhookTokens.orgId, orgId), eq(webhookTokens.id, tokenId)));
    },
  };
}

export type WebhookTokensRepo = ReturnType<typeof makeWebhookTokensRepo>;
