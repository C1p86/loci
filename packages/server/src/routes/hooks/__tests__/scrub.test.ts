// packages/server/src/routes/hooks/__tests__/scrub.test.ts
// Plan 12-03 Task 1 TDD RED — scrubHeaders deny-list assertions.
// D-25: sensitive header names stripped case-insensitively before DLQ persist.

import { describe, expect, it } from 'vitest';
import {
  SENSITIVE_HEADER_DENYLIST,
  scrubBody,
  scrubHeaders,
} from '../scrub.js';

describe('SENSITIVE_HEADER_DENYLIST', () => {
  it('is a readonly array of lowercase strings', () => {
    expect(Array.isArray(SENSITIVE_HEADER_DENYLIST)).toBe(true);
    for (const key of SENSITIVE_HEADER_DENYLIST) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('contains all required deny-list entries', () => {
    const required = [
      'authorization',
      'x-hub-signature',
      'x-hub-signature-256',
      'x-github-token',
      'x-xci-token',
      'cookie',
      'set-cookie',
    ];
    for (const key of required) {
      expect(SENSITIVE_HEADER_DENYLIST).toContain(key);
    }
  });
});

describe('scrubHeaders', () => {
  it('removes authorization (lowercase)', () => {
    const result = scrubHeaders({ authorization: 'Bearer token123', 'content-type': 'application/json' });
    expect(result).not.toHaveProperty('authorization');
    expect(result).toHaveProperty('content-type');
  });

  it('removes Authorization (PascalCase)', () => {
    const result = scrubHeaders({ Authorization: 'Bearer xyz', 'User-Agent': 'GitHub-Hookshot' });
    expect(result).not.toHaveProperty('Authorization');
    expect(result).toHaveProperty('User-Agent');
  });

  it('removes AUTHORIZATION (uppercase)', () => {
    const result = scrubHeaders({ AUTHORIZATION: 'Bearer abc' });
    expect(result).not.toHaveProperty('AUTHORIZATION');
  });

  it('removes x-hub-signature', () => {
    const result = scrubHeaders({ 'x-hub-signature': 'sha1=abc' });
    expect(result).not.toHaveProperty('x-hub-signature');
  });

  it('removes x-hub-signature-256', () => {
    const result = scrubHeaders({ 'x-hub-signature-256': 'sha256=abc', 'x-github-event': 'push' });
    expect(result).not.toHaveProperty('x-hub-signature-256');
    expect(result).toHaveProperty('x-github-event');
  });

  it('removes X-Hub-Signature-256 (mixed case)', () => {
    const result = scrubHeaders({ 'X-Hub-Signature-256': 'sha256=abc' });
    expect(result).not.toHaveProperty('X-Hub-Signature-256');
  });

  it('removes x-github-token', () => {
    const result = scrubHeaders({ 'x-github-token': 'ghp_token' });
    expect(result).not.toHaveProperty('x-github-token');
  });

  it('removes x-xci-token', () => {
    const result = scrubHeaders({ 'x-xci-token': 'my-secret-token' });
    expect(result).not.toHaveProperty('x-xci-token');
  });

  it('removes cookie', () => {
    const result = scrubHeaders({ cookie: 'session=abc' });
    expect(result).not.toHaveProperty('cookie');
  });

  it('removes set-cookie', () => {
    const result = scrubHeaders({ 'set-cookie': 'session=abc; HttpOnly' });
    expect(result).not.toHaveProperty('set-cookie');
  });

  it('keeps non-sensitive headers untouched', () => {
    const input = {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': 'some-uuid',
      'user-agent': 'GitHub-Hookshot/abc123',
      'content-length': '150',
    };
    const result = scrubHeaders(input);
    expect(result).toEqual(input);
  });

  it('returns empty object when all headers are denied', () => {
    const result = scrubHeaders({
      authorization: 'x',
      'x-hub-signature': 'y',
      'x-hub-signature-256': 'z',
      'set-cookie': 's',
    });
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('does not mutate the input object', () => {
    const input = { authorization: 'Bearer xyz', 'content-type': 'application/json' };
    const original = { ...input };
    scrubHeaders(input);
    expect(input).toEqual(original);
  });

  it('strips a full realistic GitHub webhook header set', () => {
    const result = scrubHeaders({
      Authorization: 'Bearer xxx',
      'X-Hub-Signature-256': 'sha256=abc',
      'User-Agent': 'GitHub-Hookshot',
    });
    expect(result).toEqual({ 'User-Agent': 'GitHub-Hookshot' });
  });

  it('strips x-github-token mixed case', () => {
    const result = scrubHeaders({ 'X-GitHub-Token': 'tok123', 'x-github-event': 'push' });
    expect(result).not.toHaveProperty('X-GitHub-Token');
    expect(result).toHaveProperty('x-github-event');
  });
});

describe('scrubBody', () => {
  it('returns the input unchanged (identity pass-through per D-26)', () => {
    const body = { ref: 'refs/heads/main', repository: { full_name: 'acme/infra' } };
    expect(scrubBody(body)).toBe(body);
  });

  it('returns primitives unchanged', () => {
    expect(scrubBody('hello')).toBe('hello');
    expect(scrubBody(42)).toBe(42);
    expect(scrubBody(null)).toBe(null);
  });

  it('returns undefined unchanged', () => {
    expect(scrubBody(undefined)).toBe(undefined);
  });
});
