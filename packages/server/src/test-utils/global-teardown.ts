import { teardownTestDb } from './db-harness.js';

export default async function (): Promise<void> {
  await teardownTestDb();
}
