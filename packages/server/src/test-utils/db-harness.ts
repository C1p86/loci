// packages/server/src/test-utils/db-harness.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { runMigrations } from '../db/migrator.js';

let container: StartedPostgreSqlContainer | undefined;
let client: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase | undefined;

export async function setupTestDb(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('xci_test')
    .withUsername('test')
    .withPassword('test')
    .start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = postgres(url, { max: 4 });
  db = drizzle(client);
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
