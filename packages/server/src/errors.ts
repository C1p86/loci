// src/errors.ts
//
// Full XciServerError hierarchy (D-08).
// Mirrors v1 LociError pattern from packages/xci/src/errors.ts.
// Later plans import and throw; keep additions minimal.

/**
 * HTTP status codes mapped per category. Stable — do not renumber.
 */
export const HttpStatus = {
  OK: 200,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;
export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];

export type XciServerErrorCategory =
  | 'validation'
  | 'authn'
  | 'authz'
  | 'notfound'
  | 'conflict'
  | 'ratelimit'
  | 'internal';

export interface XciServerErrorOptions {
  /** Machine ID, e.g. "AUTHN_INVALID_CREDENTIALS". Must be unique across the entire hierarchy. */
  code: string;
  suggestion?: string;
  /** Standard ES2022 Error.cause — use for wrapping underlying errors. */
  cause?: unknown;
}

/**
 * Abstract base for all server errors. Never throw directly — always throw
 * a concrete subclass (e.g. InvalidCredentialsError, DatabaseError).
 */
export abstract class XciServerError extends Error {
  public readonly code: string;
  public abstract readonly category: XciServerErrorCategory;
  public readonly suggestion?: string;

  constructor(message: string, options: XciServerErrorOptions) {
    // Pass Error.cause through the standard ES2022 channel.
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    if (options.suggestion !== undefined) {
      this.suggestion = options.suggestion;
    }
  }
}

/* ---------- Area base classes ---------- */

export abstract class ValidationError extends XciServerError {
  public readonly category = 'validation' as const;
}

export abstract class AuthnError extends XciServerError {
  public readonly category = 'authn' as const;
}

export abstract class AuthzError extends XciServerError {
  public readonly category = 'authz' as const;
}

export abstract class NotFoundError extends XciServerError {
  public readonly category = 'notfound' as const;
}

export abstract class ConflictError extends XciServerError {
  public readonly category = 'conflict' as const;
}

export abstract class RateLimitError extends XciServerError {
  public readonly category = 'ratelimit' as const;
}

export abstract class InternalError extends XciServerError {
  public readonly category = 'internal' as const;
}

/* ---------- Concrete subclasses (Phase 7) ---------- */

// ValidationError subclasses
export class SchemaValidationError extends ValidationError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      code: 'VAL_SCHEMA',
      cause,
      suggestion: 'Check the request body against the endpoint schema',
    });
  }
}

export class WeakPasswordError extends ValidationError {
  constructor() {
    super('Password must be at least 12 characters', {
      code: 'VAL_WEAK_PASSWORD',
      suggestion: 'Use a longer password; length beats complexity (NIST SP 800-63B)',
    });
  }
}

// AuthnError subclasses
export class InvalidCredentialsError extends AuthnError {
  constructor() {
    // NB: never accept email/password in the constructor — avoids accidental logging (D-10).
    super('Invalid email or password', { code: 'AUTHN_INVALID_CREDENTIALS' });
  }
}

export class SessionRequiredError extends AuthnError {
  constructor() {
    super('Authentication required', { code: 'AUTHN_SESSION_REQUIRED' });
  }
}

export class SessionExpiredError extends AuthnError {
  constructor() {
    super('Session expired', {
      code: 'AUTHN_SESSION_EXPIRED',
      suggestion: 'Log in again',
    });
  }
}

export class TokenInvalidError extends AuthnError {
  constructor() {
    // NB: do NOT accept the token value in the constructor — avoid logging (D-10).
    super('Token is invalid or expired', { code: 'AUTHN_TOKEN_INVALID' });
  }
}

export class EmailNotVerifiedError extends AuthnError {
  constructor() {
    super('Email address is not verified', {
      code: 'AUTHN_EMAIL_NOT_VERIFIED',
      suggestion: 'Check your inbox for the verification email',
    });
  }
}

// AuthzError subclasses
export class OrgMembershipRequiredError extends AuthzError {
  constructor(orgId: string) {
    // orgId is safe to include — not a secret.
    super(`Not a member of org ${orgId}`, { code: 'AUTHZ_NOT_ORG_MEMBER' });
  }
}

export class RoleInsufficientError extends AuthzError {
  constructor(requiredRole: 'owner' | 'member') {
    super(`Operation requires role ${requiredRole}`, { code: 'AUTHZ_ROLE_INSUFFICIENT' });
  }
}

export class CsrfTokenError extends AuthzError {
  constructor() {
    super('CSRF token missing or invalid', { code: 'AUTHZ_CSRF_INVALID' });
  }
}

export class InviteEmailMismatchError extends AuthzError {
  constructor() {
    super('Invite email does not match your account email', {
      code: 'AUTHZ_INVITE_EMAIL_MISMATCH',
    });
  }
}

// NotFoundError subclasses
export class UserNotFoundError extends NotFoundError {
  constructor() {
    super('User not found', { code: 'NF_USER' });
  }
}

export class OrgNotFoundError extends NotFoundError {
  constructor(orgId: string) {
    super(`Org ${orgId} not found`, { code: 'NF_ORG' });
  }
}

export class InviteNotFoundError extends NotFoundError {
  constructor() {
    super('Invite not found or already consumed', { code: 'NF_INVITE' });
  }
}

// ConflictError subclasses
export class EmailAlreadyRegisteredError extends ConflictError {
  constructor() {
    // Deliberately no email in the message to prevent enumeration via error body.
    super('Email address is already registered', { code: 'CONFLICT_EMAIL_TAKEN' });
  }
}

export class InviteAlreadyAcceptedError extends ConflictError {
  constructor() {
    super('Invite has already been accepted', { code: 'CONFLICT_INVITE_USED' });
  }
}

export class OwnerRoleImmutableError extends ConflictError {
  constructor() {
    super('Owner role cannot be removed or transferred in Phase 7', {
      code: 'CONFLICT_OWNER_IMMUTABLE',
    });
  }
}

// RateLimitError subclasses
export class RateLimitExceededError extends RateLimitError {
  constructor(retryAfterSeconds: number) {
    super('Too many requests', {
      code: 'RATE_EXCEEDED',
      suggestion: `Retry after ${retryAfterSeconds}s`,
    });
  }
}

// InternalError subclasses
export class DatabaseError extends InternalError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'INT_DATABASE', cause });
  }
}

export class EmailTransportError extends InternalError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'INT_EMAIL_TRANSPORT', cause });
  }
}

// Phase 8 — agent authentication
export class AgentTokenInvalidError extends AuthnError {
  constructor() {
    super('Agent token invalid or expired', {
      code: 'AUTHN_AGENT_TOKEN_INVALID',
      suggestion: 'Request a new registration token from an Owner or Member',
    });
  }
}

export class AgentRevokedError extends AuthnError {
  constructor() {
    super('Agent credential has been revoked', {
      code: 'AUTHN_AGENT_REVOKED',
      suggestion: 'The agent must re-register with a new registration token',
    });
    // D-10 discipline: no plaintext credential or agent_id in the message
  }
}

export class RegistrationTokenExpiredError extends AuthnError {
  constructor() {
    super('Registration token expired or already consumed', {
      code: 'AUTHN_REGISTRATION_TOKEN_EXPIRED',
      suggestion: 'Generate a new registration token (valid 24h, single-use)',
    });
  }
}

export class AgentHandshakeTimeoutError extends AuthnError {
  constructor() {
    super('Agent handshake timed out (no first frame within 5s)', {
      code: 'AUTHN_HANDSHAKE_TIMEOUT',
      suggestion: 'Agent must send register or reconnect frame within 5s of WS open',
    });
  }
}

export class AgentPatchEmptyError extends ValidationError {
  constructor() {
    super('At least one of hostname or state must be provided', {
      code: 'VAL_AGENT_PATCH_EMPTY',
    });
  }
}

// Phase 8 — agent frame validation
export class AgentFrameInvalidError extends ValidationError {
  constructor(reason: string) {
    super(`Agent frame invalid: ${reason}`, {
      code: 'VAL_AGENT_FRAME',
    });
    // D-10: `reason` is a short tag (e.g. 'json', 'missing type', 'unknown type: X') — never a token
  }
}

/* ---------- Category → HTTP status exhaustive mapping ---------- */

/**
 * Exhaustive switch on XciServerErrorCategory — adding a new category without
 * updating this function causes a TypeScript compile error.
 */
export function httpStatusFor(err: XciServerError): HttpStatus {
  switch (err.category) {
    case 'validation':
      return HttpStatus.BAD_REQUEST;
    case 'authn':
      return HttpStatus.UNAUTHORIZED;
    case 'authz':
      return HttpStatus.FORBIDDEN;
    case 'notfound':
      return HttpStatus.NOT_FOUND;
    case 'conflict':
      return HttpStatus.CONFLICT;
    case 'ratelimit':
      return HttpStatus.RATE_LIMITED;
    case 'internal':
      return HttpStatus.INTERNAL;
    default: {
      // TS exhaustive check — adding a new category without adding a case is a compile error
      const _exhaustive: never = err.category;
      return _exhaustive;
    }
  }
}
