import { setupTestDb } from './db-harness.js';

export default async function (): Promise<void> {
  await setupTestDb();
}
