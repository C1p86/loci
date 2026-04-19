import { buildApp } from './app.js';
import { argon2SelfTest } from './crypto/password.js';
import { runMigrations } from './db/migrator.js';

async function main(): Promise<void> {
  const app = await buildApp();

  // PKG-07: apply Drizzle migrations at boot using the programmatic migrator.
  // drizzle-kit is a devDependency and is NOT present in the production image (D-02).
  // DATABASE_URL is validated by @fastify/env before we get here.
  app.log.info('running database migrations');
  await runMigrations(app.config.DATABASE_URL);
  app.log.info('migrations complete');

  // Pitfall 3: warm up argon2 + time the first hash to catch weak/strong param drift
  await argon2SelfTest(app.log);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ host: '0.0.0.0', port: app.config.PORT });
    app.log.info({ port: app.config.PORT }, 'xci server listening');
  } catch (err) {
    app.log.error({ err }, 'failed to listen');
    process.exit(1);
  }
}

void main();
