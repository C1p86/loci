// packages/server/src/test-utils/db-harness.ts
import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { runMigrations } from '../db/migrator.js';

let container: StartedPostgreSqlContainer | undefined;
let client: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase | undefined;
let dbUrl: string | undefined;

export async function setupTestDb(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('xci_test')
    .withUsername('test')
    .withPassword('test')
    .start();
  dbUrl = container.getConnectionUri();
  await runMigrations(dbUrl);
  client = postgres(dbUrl, { max: 4 });
  db = drizzle(client);
}

/** Returns the testcontainer connection URI — set into process.env.DATABASE_URL by globalSetup. */
export function getTestDbUrl(): string {
  if (!dbUrl) throw new Error('getTestDbUrl called before setupTestDb — missing globalSetup?');
  return dbUrl;
}

export async function teardownTestDb(): Promise<void> {
  await client?.end({ timeout: 5 });
  await container?.stop();
  container = undefined;
  client = undefined;
  db = undefined;
}

export function getTestDb(): PostgresJsDatabase {
  if (!db) throw new Error('getTestDb called before setupTestDb — missing globalSetup?');
  return db;
}

/**
 * D-22 + Pitfall 5: TRUNCATE all public tables dynamically.
 * Enumerates from information_schema so new tables added in Phase 8+ are auto-included.
 * Never hardcodes a table list to avoid drift.
 */
/**
 * A stable 32-byte test MEK for integration tests that call makeRepos(db, mek).
 * Derived from process.env.XCI_MASTER_KEY so that makeRepos() and buildApp() both
 * use the same key during integration tests (D-13 / Phase 9).
 * Must be called AFTER global-setup sets process.env.XCI_MASTER_KEY.
 */
export function getTestMek(): Buffer {
  const raw = process.env.XCI_MASTER_KEY;
  if (!raw)
    throw new Error('getTestMek: process.env.XCI_MASTER_KEY not set — missing globalSetup?');
  return Buffer.from(raw, 'base64');
}

/**
 * @deprecated Use getTestMek() for consistency with buildApp() MEK parsing.
 * Kept for backward compat with existing tests that already import TEST_MEK.
 */
export const TEST_MEK: Buffer = randomBytes(32);

export async function resetDb(): Promise<void> {
  if (!db) throw new Error('resetDb called before setupTestDb');
  await db.execute(sql`
    DO $$
    DECLARE
      stmt text;
    BEGIN
      SELECT 'TRUNCATE TABLE ' || string_agg(quote_ident(table_name), ', ') || ' RESTART IDENTITY CASCADE'
      INTO stmt
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name != '__drizzle_migrations';
      IF stmt IS NOT NULL THEN EXECUTE stmt; END IF;
    END $$;
  `);
}
