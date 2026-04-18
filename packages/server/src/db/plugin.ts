// packages/server/src/db/plugin.ts
import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

declare module 'fastify' {
  interface FastifyInstance {
    db: PostgresJsDatabase;
  }
}

const dbPlugin: FastifyPluginAsync<{ databaseUrl?: string }> = async (fastify, opts) => {
  // Read URL from env (registered by fastify-env, available via fastify.config)
  // or from explicit opts for test injection (D-05).
  const url = opts.databaseUrl ?? (fastify as FastifyInstance & { config?: { DATABASE_URL?: string } }).config?.DATABASE_URL;
  if (!url) throw new Error('dbPlugin: DATABASE_URL missing from both opts and fastify.config');
  const client = postgres(url, { max: 10 });
  const db = drizzle(client);
  fastify.decorate('db', db);
  fastify.addHook('onClose', async () => {
    await client.end({ timeout: 5 });
  });
};

export default fp(dbPlugin, { name: 'db-plugin', dependencies: ['@fastify/env'] });

// Named export for explicit import style
export { dbPlugin };
