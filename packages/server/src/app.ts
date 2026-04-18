import { randomUUID } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import fastifyEnv from '@fastify/env';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { envSchema } from './config/env.schema.js';
import dbPlugin from './db/plugin.js';
import { createTransport, type EmailTransport } from './email/transport.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import { registerRoutes } from './routes/index.js';

export interface BuildOpts {
  /** Override DATABASE_URL — only for tests that want a specific DB. */
  databaseUrl?: string;
  /** Override email transport — tests pass createTransport('stub', {logger}). */
  emailTransport?: EmailTransport;
  /** Override now() for deterministic session-expiry tests (D-05). */
  clock?: () => Date;
  /** Override crypto.randomBytes for deterministic token tests. */
  randomBytes?: (size: number) => Buffer;
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

export async function buildApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? (process.env.NODE_ENV === 'test' ? 'warn' : 'info'),
      redact: {
        paths: [
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
          'req.body.token',
          'req.body.registrationToken',
          'req.body.credential',
          'req.headers.cookie',
          'req.headers.authorization',
          'req.raw.headers.cookie',
          'req.raw.headers.authorization',
          '*.password',
          '*.token',
          '*.credential',
        ],
        censor: '[REDACTED]',
      },
      ...(process.env.NODE_ENV !== 'production' &&
        process.env.NODE_ENV !== 'test' && {
          transport: { target: 'pino-pretty' },
        }),
    },
    genReqId: () => randomUUID(),
    disableRequestLogging: process.env.NODE_ENV === 'test',
  });

  // D-06 plugin order — DO NOT reorder
  await app.register(fastifyEnv, { schema: envSchema, dotenv: false });
  await app.register(
    dbPlugin,
    opts.databaseUrl !== undefined ? { databaseUrl: opts.databaseUrl } : {},
  );
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });
  await app.register(fastifyCookie, { secret: app.config.SESSION_COOKIE_SECRET });
  await app.register(fastifyCsrf, {
    cookieKey: '_csrf',
    cookieOpts: {
      path: '/',
      sameSite: 'strict',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    },
    getToken: (req) => req.headers['x-csrf-token'] as string | undefined,
  });
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    cache: 10_000,
  });

  // Decorate fastify with resolved email transport (injected or env-derived)
  const emailTransport =
    opts.emailTransport ??
    createTransport(app.config.EMAIL_TRANSPORT, {
      ...(app.config.SMTP_HOST !== undefined && { SMTP_HOST: app.config.SMTP_HOST }),
      SMTP_PORT: app.config.SMTP_PORT,
      ...(app.config.SMTP_USER !== undefined && { SMTP_USER: app.config.SMTP_USER }),
      ...(app.config.SMTP_PASS !== undefined && { SMTP_PASS: app.config.SMTP_PASS }),
      ...(app.config.SMTP_FROM !== undefined && { SMTP_FROM: app.config.SMTP_FROM }),
      logger: app.log,
    });
  app.decorate('emailTransport', emailTransport);

  await app.register(authPlugin, opts.clock !== undefined ? { clock: opts.clock } : {});
  await app.register(errorHandlerPlugin);

  // Phase 8 D-17 + Pitfall 8: decorate BEFORE registering fastifyWebsocket.
  app.decorate('agentRegistry', new Map<string, WebSocket>());

  // Phase 8 D-13: WS plugin. Register AFTER auth (D-06) so auth plugin's onRequest hook still runs on HTTP upgrade.
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 65536 }, // 64KB max frame — handshake frames are <1KB
  });

  await app.register(registerRoutes, { prefix: '/api' });

  return app;
}

// Type augmentation so `app.emailTransport` and `app.agentRegistry` are typed
declare module 'fastify' {
  interface FastifyInstance {
    emailTransport: EmailTransport;
    agentRegistry: Map<string, WebSocket>; // Phase 8 D-17
  }
}
