import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  DatabaseError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  OrgMembershipRequiredError,
  RateLimitExceededError,
  SchemaValidationError,
  UserNotFoundError,
} from '../../errors.js';
import errorHandlerPlugin from '../error-handler.js';

async function buildBare() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  return app;
}

describe('error-handler plugin (D-08)', () => {
  it('XciServerError → status + {code,message,requestId}', async () => {
    const app = await buildBare();
    app.get('/t', async () => {
      throw new InvalidCredentialsError();
    });
    const res = await app.inject({ method: 'GET', url: '/t' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe('AUTHN_INVALID_CREDENTIALS');
    expect(body.message).toBe('Invalid email or password');
    expect(body.requestId).toBeDefined();
  });

  it.each([
    [new SchemaValidationError('bad body'), 400, 'VAL_SCHEMA'],
    [new OrgMembershipRequiredError('xci_org_x'), 403, 'AUTHZ_NOT_ORG_MEMBER'],
    [new UserNotFoundError(), 404, 'NF_USER'],
    [new EmailAlreadyRegisteredError(), 409, 'CONFLICT_EMAIL_TAKEN'],
    [new RateLimitExceededError(60), 429, 'RATE_EXCEEDED'],
    [new DatabaseError('x'), 500, 'INT_DATABASE'],
  ] as const)('%s → %d / %s', async (err, status, code) => {
    const app = await buildBare();
    app.get('/t', async () => {
      throw err;
    });
    const res = await app.inject({ method: 'GET', url: '/t' });
    expect(res.statusCode).toBe(status);
    expect(res.json().code).toBe(code);
  });

  it('unknown error → 500 INT_UNKNOWN; no stack in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const app = await buildBare();
      app.get('/t', async () => {
        throw new Error('boom');
      });
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('INT_UNKNOWN');
      expect(res.json().stack).toBeUndefined();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('unknown error → 500 INT_UNKNOWN; includes stack in development', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const app = await buildBare();
      app.get('/t', async () => {
        throw new Error('boom');
      });
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.statusCode).toBe(500);
      expect(res.json().stack).toBeDefined();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('fastify body validation → 400 VAL_SCHEMA', async () => {
    const app = await buildBare();
    app.post(
      '/t',
      {
        schema: {
          body: {
            type: 'object',
            required: ['x'],
            properties: { x: { type: 'string' } },
          },
        },
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({ method: 'POST', url: '/t', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VAL_SCHEMA');
  });
});
