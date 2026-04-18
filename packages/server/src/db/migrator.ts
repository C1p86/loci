// packages/server/src/db/migrator.ts
// Source: https://orm.drizzle.team/docs/migrations

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * D-28: Programmatic migrator at boot. Used both in production server.ts
 * and in test-utils/db-harness.ts after the testcontainer starts.
 * Uses max:1 to avoid holding a pool during boot.
 *
 * Path resolution: from src/db/ (tsx/vitest) OR dist/db/ (compiled),
 * both resolve to packages/server/drizzle/ via ../../drizzle.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  // Single-connection client for migrations — closes after migrate() returns.
  const migrationClient = postgres(databaseUrl, { max: 1 });
  const migrationDb = drizzle(migrationClient);
  try {
    await migrate(migrationDb, {
      // Dev: src/db/migrator.ts → ../../drizzle = packages/server/drizzle
      // Built: dist/db/migrator.js → ../../drizzle = packages/server/drizzle (drizzle/ ships in package files)
      migrationsFolder: path.join(__dirname, '..', '..', 'drizzle'),
    });
  } finally {
    await migrationClient.end({ timeout: 5 });
  }
}
