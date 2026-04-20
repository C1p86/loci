import { describe, expect, it } from 'vitest';
import { buildEmailLink } from '../link.js';

describe('buildEmailLink (Quick 260420-v15)', () => {
  it('uses APP_BASE_URL verbatim as prefix when set', () => {
    const link = buildEmailLink(
      { appBaseUrl: 'http://localhost:3000', headerHost: 'x' },
      '/verify-email',
      'token',
      'abc',
    );
    expect(link).toBe('http://localhost:3000/verify-email?token=abc');
  });

  it('falls back to https://<headerHost> when APP_BASE_URL is unset', () => {
    const link = buildEmailLink(
      { appBaseUrl: undefined, headerHost: 'example.com' },
      '/reset',
      'token',
      'xyz',
    );
    expect(link).toBe('https://example.com/reset?token=xyz');
  });

  it('falls back to https://localhost when both APP_BASE_URL and headerHost are unset', () => {
    const link = buildEmailLink(
      { appBaseUrl: undefined, headerHost: undefined },
      '/invites/abc/accept',
      'token',
      'abc',
    );
    expect(link).toBe('https://localhost/invites/abc/accept?token=abc');
  });

  it('URL-encodes the query value (e.g. tokens containing = and /)', () => {
    const link = buildEmailLink(
      { appBaseUrl: 'http://localhost:3000', headerHost: undefined },
      '/verify-email',
      'token',
      'a/b=',
    );
    expect(link).toBe('http://localhost:3000/verify-email?token=a%2Fb%3D');
  });

  it('does not re-encode the path (caller owns path-segment encoding)', () => {
    const encoded = encodeURIComponent('raw/tok');
    const link = buildEmailLink(
      { appBaseUrl: 'http://localhost:3000', headerHost: undefined },
      `/invites/${encoded}/accept`,
      'token',
      'raw/tok',
    );
    expect(link).toBe('http://localhost:3000/invites/raw%2Ftok/accept?token=raw%2Ftok');
  });
});
