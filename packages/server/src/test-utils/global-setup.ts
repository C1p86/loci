import { randomBytes } from 'node:crypto';
import { getTestDbUrl, setupTestDb } from './db-harness.js';

export default async function (): Promise<void> {
  await setupTestDb();
  // Expose the testcontainer URI + required env vars for buildApp() during integration tests.
  process.env.DATABASE_URL = getTestDbUrl();
  process.env.SESSION_COOKIE_SECRET = 'test-cookie-secret-at-least-32-bytes-long!';
  process.env.EMAIL_TRANSPORT = 'stub';
  process.env.NODE_ENV = 'test';
  // Phase 9 D-13: XCI_MASTER_KEY required at boot — generate a stable test MEK for the session.
  // Tests that need a specific MEK (e.g. rotate-mek D-26 roundtrip) manage it per-test.
  if (!process.env.XCI_MASTER_KEY) {
    process.env.XCI_MASTER_KEY = randomBytes(32).toString('base64');
  }
  // Phase 9 D-24: PLATFORM_ADMIN_EMAIL required at boot — set stable test value.
  if (!process.env.PLATFORM_ADMIN_EMAIL) {
    process.env.PLATFORM_ADMIN_EMAIL = 'admin@xci.test';
  }
}
