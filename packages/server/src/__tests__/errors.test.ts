// src/__tests__/errors.test.ts
import { describe, expect, it } from 'vitest';
import {
  AgentFrameInvalidError,
  AgentHandshakeTimeoutError,
  AgentPatchEmptyError,
  AgentRevokedError,
  AgentTokenInvalidError,
  AuthnError,
  AuthzError,
  ConflictError,
  CsrfTokenError,
  DatabaseError,
  EmailAlreadyRegisteredError,
  EmailNotVerifiedError,
  EmailTransportError,
  // HTTP status mapping
  HttpStatus,
  httpStatusFor,
  InternalError,
  InvalidCredentialsError,
  InviteAlreadyAcceptedError,
  InviteEmailMismatchError,
  InviteNotFoundError,
  // Phase 9 new subclasses
  MekRotationError,
  NotFoundError,
  OrgMembershipRequiredError,
  OrgNotFoundError,
  OwnerRoleImmutableError,
  PlatformAdminRequiredError,
  RateLimitError,
  RateLimitExceededError,
  RegistrationTokenExpiredError,
  RoleInsufficientError,
  // Concrete subclasses
  SchemaValidationError,
  SecretDecryptError,
  SecretNameConflictError,
  SecretNotFoundError,
  SessionExpiredError,
  SessionRequiredError,
  TaskNameConflictError,
  TaskNotFoundError,
  TaskValidationError,
  TokenInvalidError,
  UserNotFoundError,
  ValidationError,
  WeakPasswordError,
  // Abstract bases
  XciServerError,
} from '../errors.js';

/**
 * Factory returning a fresh instance of every concrete XciServerError subclass.
 * Used by code-uniqueness and http-status-mapping tests to avoid drift.
 */
function oneOfEachConcrete(): readonly XciServerError[] {
  return [
    new SchemaValidationError('bad body'),
    new WeakPasswordError(),
    new InvalidCredentialsError(),
    new SessionRequiredError(),
    new SessionExpiredError(),
    new TokenInvalidError(),
    new EmailNotVerifiedError(),
    new OrgMembershipRequiredError('xci_org_abc'),
    new RoleInsufficientError('owner'),
    new CsrfTokenError(),
    new InviteEmailMismatchError(),
    new UserNotFoundError(),
    new OrgNotFoundError('xci_org_abc'),
    new InviteNotFoundError(),
    new EmailAlreadyRegisteredError(),
    new InviteAlreadyAcceptedError(),
    new OwnerRoleImmutableError(),
    new RateLimitExceededError(60),
    new DatabaseError('db failure'),
    new EmailTransportError('smtp failure'),
    new AgentTokenInvalidError(),
    new AgentRevokedError(),
    new RegistrationTokenExpiredError(),
    new AgentHandshakeTimeoutError(),
    new AgentFrameInvalidError('test reason'),
    new AgentPatchEmptyError(),
    // Phase 9 new subclasses
    new TaskValidationError([]),
    new TaskNotFoundError(),
    new TaskNameConflictError(),
    new SecretNotFoundError(),
    new SecretNameConflictError(),
    new SecretDecryptError(),
    new MekRotationError('test'),
    new PlatformAdminRequiredError(),
  ];
}

describe('XciServerError hierarchy — instanceof chains', () => {
  it('SchemaValidationError → ValidationError → XciServerError → Error', () => {
    const err = new SchemaValidationError('bad body');
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toBeInstanceOf(XciServerError);
    expect(err).toBeInstanceOf(Error);
  });

  it('InvalidCredentialsError → AuthnError → XciServerError → Error', () => {
    const err = new InvalidCredentialsError();
    expect(err).toBeInstanceOf(InvalidCredentialsError);
    expect(err).toBeInstanceOf(AuthnError);
    expect(err).toBeInstanceOf(XciServerError);
    expect(err).toBeInstanceOf(Error);
  });

  it('OrgMembershipRequiredError → AuthzError → XciServerError → Error', () => {
    const err = new OrgMembershipRequiredError('xci_org_abc');
    expect(err).toBeInstanceOf(OrgMembershipRequiredError);
    expect(err).toBeInstanceOf(AuthzError);
    expect(err).toBeInstanceOf(XciServerError);
    expect(err).toBeInstanceOf(Error);
  });

  it('UserNotFoundError → NotFoundError → XciServerError → Error', () => {
    const err = new UserNotFoundError();
    expect(err).toBeInstanceOf(UserNotFoundError);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err).toBeInstanceOf(XciServerError);
    expect(err).toBeInstanceOf(Error);
  });

  it('EmailAlreadyRegisteredError → ConflictError → XciServerError → Error', () => {
    const err = new EmailAlreadyRegisteredError();
    expect(err).toBeInstanceOf(EmailAlreadyRegisteredError);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toBeInstanceOf(XciServerError);
    expect(err).toBeInstanceOf(Error);
  });

  it('RateLimitExceededError → RateLimitError → XciServerError → Error', () => {
    const err = new RateLimitExceededError(30);
    expect(err).toBeInstanceOf(RateLimitExceededError);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err).toBeInstanceOf(XciServerError);
    expect(err).toBeInstanceOf(Error);
  });

  it('DatabaseError → InternalError → XciServerError → Error', () => {
    const err = new DatabaseError('query failed');
    expect(err).toBeInstanceOf(DatabaseError);
    expect(err).toBeInstanceOf(InternalError);
    expect(err).toBeInstanceOf(XciServerError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('XciServerError — runtime name (new.target.name)', () => {
  it('sets name to the concrete subclass, not XciServerError or Error', () => {
    const err = new InvalidCredentialsError();
    expect(err.name).toBe('InvalidCredentialsError');
  });

  it('preserves the name across all concrete subclasses', () => {
    const instances = oneOfEachConcrete();
    for (const err of instances) {
      expect(err.name).toBe(err.constructor.name);
      expect(err.name).not.toBe('Error');
      expect(err.name).not.toBe('XciServerError');
    }
  });
});

describe('XciServerError — Error.cause propagation (ES2022)', () => {
  it('SchemaValidationError propagates cause', () => {
    const inner = new Error('ajv validation failed');
    const err = new SchemaValidationError('bad body', inner);
    expect(err.cause).toBe(inner);
  });

  it('DatabaseError propagates cause', () => {
    const inner = new Error('connection refused');
    const err = new DatabaseError('query failed', inner);
    expect(err.cause).toBe(inner);
  });

  it('EmailTransportError propagates cause', () => {
    const inner = new Error('ECONNRESET');
    const err = new EmailTransportError('SMTP send failed', inner);
    expect(err.cause).toBe(inner);
  });

  it('errors without cause have cause undefined', () => {
    const err = new InvalidCredentialsError();
    expect(err.cause).toBeUndefined();
  });
});

describe('XciServerError — structured error shape', () => {
  it('every concrete subclass has a non-empty string code', () => {
    const instances = oneOfEachConcrete();
    for (const err of instances) {
      expect(typeof err.code).toBe('string');
      expect(err.code.length).toBeGreaterThan(0);
    }
  });

  it('every concrete subclass has a unique code across the hierarchy', () => {
    const instances = oneOfEachConcrete();
    const codes = instances.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('suggestion is optional — WeakPasswordError has it, InvalidCredentialsError does not', () => {
    const withSuggestion = new WeakPasswordError();
    expect(withSuggestion.suggestion).toBeDefined();
    const withoutSuggestion = new InvalidCredentialsError();
    expect(withoutSuggestion.suggestion).toBeUndefined();
  });
});

describe('HttpStatus + httpStatusFor — category-to-HTTP-status mapping', () => {
  it('HttpStatus constants are correct', () => {
    expect(HttpStatus.BAD_REQUEST).toBe(400);
    expect(HttpStatus.UNAUTHORIZED).toBe(401);
    expect(HttpStatus.FORBIDDEN).toBe(403);
    expect(HttpStatus.NOT_FOUND).toBe(404);
    expect(HttpStatus.CONFLICT).toBe(409);
    expect(HttpStatus.RATE_LIMITED).toBe(429);
    expect(HttpStatus.INTERNAL).toBe(500);
  });

  it('validation → 400 BAD_REQUEST', () => {
    expect(httpStatusFor(new SchemaValidationError('x'))).toBe(HttpStatus.BAD_REQUEST);
    expect(httpStatusFor(new WeakPasswordError())).toBe(400);
  });

  it('authn → 401 UNAUTHORIZED', () => {
    expect(httpStatusFor(new InvalidCredentialsError())).toBe(HttpStatus.UNAUTHORIZED);
    expect(httpStatusFor(new SessionExpiredError())).toBe(401);
    expect(httpStatusFor(new TokenInvalidError())).toBe(401);
  });

  it('authz → 403 FORBIDDEN', () => {
    expect(httpStatusFor(new OrgMembershipRequiredError('x'))).toBe(HttpStatus.FORBIDDEN);
    expect(httpStatusFor(new CsrfTokenError())).toBe(403);
  });

  it('notfound → 404 NOT_FOUND', () => {
    expect(httpStatusFor(new UserNotFoundError())).toBe(HttpStatus.NOT_FOUND);
    expect(httpStatusFor(new OrgNotFoundError('x'))).toBe(404);
  });

  it('conflict → 409 CONFLICT', () => {
    expect(httpStatusFor(new EmailAlreadyRegisteredError())).toBe(HttpStatus.CONFLICT);
  });

  it('ratelimit → 429 RATE_LIMITED', () => {
    expect(httpStatusFor(new RateLimitExceededError(60))).toBe(HttpStatus.RATE_LIMITED);
  });

  it('internal → 500 INTERNAL', () => {
    expect(httpStatusFor(new DatabaseError('x'))).toBe(HttpStatus.INTERNAL);
    expect(httpStatusFor(new EmailTransportError('x'))).toBe(500);
  });
});

describe('Secrets-safe error constructors (D-10)', () => {
  it('InvalidCredentialsError is a 0-arg constructor — never accepts email/password', () => {
    // Type-level: calling new InvalidCredentialsError() with no args must compile.
    const err = new InvalidCredentialsError();
    expect(err.message).toBe('Invalid email or password');
    // Message should NOT contain any credential value (defensive check)
    expect(err.message).not.toContain('@');
    expect(err.message).not.toContain('password123');
  });

  it('TokenInvalidError is a 0-arg constructor — never accepts the token value', () => {
    const err = new TokenInvalidError();
    expect(err.message).toBe('Token is invalid or expired');
  });

  it('EmailAlreadyRegisteredError does NOT include the email in the message (enumeration defense)', () => {
    const err = new EmailAlreadyRegisteredError();
    // Generic message — does not contain the offending address
    expect(err.message).not.toContain('@');
    expect(err.message).toContain('already registered');
  });
});
