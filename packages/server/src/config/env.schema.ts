// D-07: @fastify/env JSON schema; server fails to boot on missing/invalid env.
export const envSchema = {
  type: 'object',
  required: ['DATABASE_URL', 'SESSION_COOKIE_SECRET', 'EMAIL_TRANSPORT'],
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
    };
  }
}

// NOTE: @fastify/env's env-schema does NOT support JSON-schema `oneOf` for conditional
// SMTP field requirement. Enforce at runtime in the email transport factory:
// "if EMAIL_TRANSPORT=smtp and SMTP_HOST/SMTP_FROM missing, throw EmailTransportError at boot."
