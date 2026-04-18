import { getTestDbUrl, setupTestDb } from './db-harness.js';

export default async function (): Promise<void> {
  await setupTestDb();
  // Expose the testcontainer URI + required env vars for buildApp() during integration tests.
  process.env.DATABASE_URL = getTestDbUrl();
  process.env.SESSION_COOKIE_SECRET = 'test-cookie-secret-at-least-32-bytes-long!';
  process.env.EMAIL_TRANSPORT = 'stub';
  process.env.NODE_ENV = 'test';
}
