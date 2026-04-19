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
import { registerAgentWsRoute } from './routes/agents/index.js';
import { registerRoutes } from './routes/index.js';
import { logsWsRoute } from './routes/runs/index.js';
import { dispatcherPlugin } from './services/dispatcher.js';
import { LogBatcher } from './services/log-batcher.js';
import { LogFanout } from './services/log-fanout.js';

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
          // Phase 9 D-20: secret-specific redaction (SEC-04 architectural invariant)
          'req.body.value',
          'req.body.newMekBase64',
          '*.ciphertext',
          '*.dek',
          '*.mek',
          // Phase 10 Plan 04 T-10-04-02: param_overrides may contain plaintext secrets
          'req.body.param_overrides',
          'req.body.param_overrides.*',
          '*.taskSnapshot.params',
          '*.params',
          '*.paramOverrides',
          // Phase 12 D-06/T-12-03-06: webhook signature + token headers must not appear in logs
          'req.headers["x-hub-signature"]',
          'req.headers["x-hub-signature-256"]',
          'req.headers["x-github-token"]',
          'req.headers["x-xci-token"]',
          'req.raw.headers["x-hub-signature"]',
          'req.raw.headers["x-hub-signature-256"]',
          'req.raw.headers["x-github-token"]',
          'req.raw.headers["x-xci-token"]',
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

  // Phase 9 D-13 + Pitfall 8: parse XCI_MASTER_KEY ONCE at boot as a Buffer; never re-parse per-request.
  // Buffer.from(base64, 'base64') always returns a Buffer, but we must verify it decodes to exactly 32 bytes.
  const mek = Buffer.from(app.config.XCI_MASTER_KEY, 'base64');
  if (mek.length !== 32) {
    throw new Error(
      `XCI_MASTER_KEY must decode to exactly 32 bytes (got ${mek.length}). ` +
        "Generate a valid key with: node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  app.decorate('mek', mek);

  // Phase 8 D-17 + Pitfall 8: decorate BEFORE registering fastifyWebsocket.
  app.decorate('agentRegistry', new Map<string, WebSocket>());

  // Phase 11 D-05/D-09/D-12: log pipeline decorators.
  // runRedactionTables: per-run secret variant cache (seeded at dispatch, cleared on terminal).
  // logBatcher: buffers DB inserts (50-chunk / 200ms / 1000-overflow).
  // logFanout: live subscriber registry (500-queue drop-head per subscriber).
  app.decorate('runRedactionTables', new Map<string, readonly string[]>());
  const logBatcher = new LogBatcher(app);
  app.decorate('logBatcher', logBatcher);
  const logFanout = new LogFanout(app);
  app.decorate('logFanout', logFanout);
  // Phase 11 D-17: retention timer handle (set by startLogRetentionJob on onReady)
  app.decorate('logRetentionTimer', null as NodeJS.Timeout | null);
  app.addHook('onClose', async () => {
    // Phase 11 D-17: clear retention interval FIRST so no new cleanup fires during shutdown.
    if (app.logRetentionTimer) {
      clearInterval(app.logRetentionTimer);
      app.logRetentionTimer = null;
    }
    // Order: flush remaining chunks → stop timer → close subscriber sockets → clear redaction map.
    await logBatcher.flushAll();
    logBatcher.stop();
    logFanout.closeAll();
    app.runRedactionTables.clear();
  });

  // Phase 8 D-13: WS plugin. Register AFTER auth (D-06) so auth plugin's onRequest hook still runs on HTTP upgrade.
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 65536 }, // 64KB max frame — handshake frames are <1KB
  });

  // Phase 8 D-13: WS route at /ws/agent — NO /api prefix. Auth is via first WS frame, not session cookie.
  await app.register(registerAgentWsRoute);

  // Phase 11 D-12: WS subscribe route at /ws/orgs/:orgId/runs/:runId/logs — NO /api prefix.
  // Auth is via xci_sid session cookie (authPlugin onRequest runs on HTTP upgrade).
  await app.register(logsWsRoute);

  // Plan 10-03: dispatcher plugin AFTER websocket so agentRegistry is available in onReady.
  // T-10-03-07: fastify-plugin dependencies: ['db','websocket'] enforces this at register-time.
  await app.register(dispatcherPlugin);

  // Phase 11 D-17/D-20: start retention cleanup job after dispatcher is wired (DB is ready).
  app.addHook('onReady', async () => {
    const { startLogRetentionJob } = await import('./services/log-retention.js');
    startLogRetentionJob(app);
  });

  await app.register(registerRoutes, { prefix: '/api' });

  // Phase 12 D-04: webhook ingress at root level (no /api — external senders, machine identity)
  const { registerHookRoutes } = await import('./routes/hooks/index.js');
  await app.register(registerHookRoutes, { prefix: '/hooks' });

  return app;
}

// Type augmentation so decorated properties are typed throughout the codebase
declare module 'fastify' {
  interface FastifyInstance {
    emailTransport: EmailTransport;
    agentRegistry: Map<string, WebSocket>; // Phase 8 D-17
    mek: Buffer; // Phase 9 D-13: 32-byte MEK Buffer, parsed once at boot
    // Phase 11 D-05: per-run redaction table (seeded at dispatch, cleared on terminal)
    runRedactionTables: Map<string, readonly string[]>;
    // Phase 11 D-09/D-10: log chunk batcher (50-chunk / 200ms / 1000-overflow)
    logBatcher: LogBatcher;
    // Phase 11 D-12/D-13: live subscriber fanout registry
    logFanout: LogFanout;
    // Phase 11 D-17: retention cleanup interval handle (set by startLogRetentionJob on onReady)
    logRetentionTimer: NodeJS.Timeout | null;
  }
}
