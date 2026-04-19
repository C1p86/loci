// D-07: @fastify/env JSON schema; server fails to boot on missing/invalid env.
export const envSchema = {
  type: 'object',
  required: [
    'DATABASE_URL',
    'SESSION_COOKIE_SECRET',
    'EMAIL_TRANSPORT',
    'XCI_MASTER_KEY',
    'PLATFORM_ADMIN_EMAIL',
  ],
  properties: {
    NODE_ENV: {
      type: 'string',
      enum: ['development', 'test', 'production'],
      default: 'development',
    },
    PORT: { type: 'integer', default: 3000 },
    LOG_LEVEL: {
      type: 'string',
      enum: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
      default: 'info',
    },
    DATABASE_URL: { type: 'string', pattern: '^postgres(ql)?://' },
    SESSION_COOKIE_SECRET: { type: 'string', minLength: 32 },
    EMAIL_TRANSPORT: { type: 'string', enum: ['log', 'stub', 'smtp'] },
    // SMTP fields required only when EMAIL_TRANSPORT=smtp — enforced at runtime in transport factory
    SMTP_HOST: { type: 'string' },
    SMTP_PORT: { type: 'integer', default: 587 },
    SMTP_USER: { type: 'string' },
    SMTP_PASS: { type: 'string' },
    SMTP_FROM: { type: 'string', format: 'email' },
    // Phase 9 D-13: 32-byte MEK base64-encoded (44 chars: 43 alphabet + '=').
    // Runtime length check (Buffer.length === 32) happens in app.ts (Pitfall 8).
    XCI_MASTER_KEY: {
      type: 'string',
      minLength: 44,
      maxLength: 44,
      pattern: '^[A-Za-z0-9+/]{43}=$',
    },
    // Phase 9 D-24: email of the single platform admin who may call POST /admin/rotate-mek.
    PLATFORM_ADMIN_EMAIL: {
      type: 'string',
      format: 'email',
      minLength: 3,
      maxLength: 254,
    },
    // Phase 11 D-17: configurable retention cleanup interval for testability (default 24h)
    LOG_RETENTION_INTERVAL_MS: {
      type: 'number',
      default: 86400000,
    },
    // Phase 14 D-05: optional path to @xci/web dist bundle; enables @fastify/static when set.
    // When unset (default), static serving is disabled — server acts as pure API.
    WEB_STATIC_ROOT: { type: 'string' },
  },
  additionalProperties: false,
} as const;

// Type augmentation so `fastify.config` is typed everywhere (D-07)
declare module 'fastify' {
  interface FastifyInstance {
    config: {
      NODE_ENV: 'development' | 'test' | 'production';
      PORT: number;
      LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
      DATABASE_URL: string;
      SESSION_COOKIE_SECRET: string;
      EMAIL_TRANSPORT: 'log' | 'stub' | 'smtp';
      SMTP_HOST?: string;
      SMTP_PORT: number;
      SMTP_USER?: string;
      SMTP_PASS?: string;
      SMTP_FROM?: string;
      // Phase 9 D-13
      XCI_MASTER_KEY: string;
      // Phase 9 D-24
      PLATFORM_ADMIN_EMAIL: string;
      // Phase 11 D-17
      LOG_RETENTION_INTERVAL_MS: number;
      // Phase 14 D-05: optional static root for @fastify/static (set in Docker image)
      WEB_STATIC_ROOT?: string;
    };
  }
}

// NOTE: @fastify/env's env-schema does NOT support JSON-schema `oneOf` for conditional
// SMTP field requirement. Enforce at runtime in the email transport factory:
// "if EMAIL_TRANSPORT=smtp and SMTP_HOST/SMTP_FROM missing, throw EmailTransportError at boot."
