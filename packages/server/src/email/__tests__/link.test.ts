import { describe, expect, it } from 'vitest';
import { buildEmailLink } from '../link.js';

describe('buildEmailLink (Quick 260420-vqw)', () => {
  it('uses APP_BASE_URL verbatim as prefix when set', () => {
    const link = buildEmailLink(
      { appBaseUrl: 'http://localhost:3000', headerHost: 'x' },
      '/verify-email/abc',
    );
    expect(link).toBe('http://localhost:3000/verify-email/abc');
  });

  it('falls back to https://<headerHost> when APP_BASE_URL is unset', () => {
    const link = buildEmailLink(
      { appBaseUrl: undefined, headerHost: 'example.com' },
      '/reset-password/xyz',
    );
    expect(link).toBe('https://example.com/reset-password/xyz');
  });

  it('falls back to https://localhost when both APP_BASE_URL and headerHost are unset', () => {
    const link = buildEmailLink(
      { appBaseUrl: undefined, headerHost: undefined },
      '/invites/abc',
    );
    expect(link).toBe('https://localhost/invites/abc');
  });

  it('does not re-encode the path (caller owns path-segment encoding)', () => {
    const encoded = encodeURIComponent('raw/tok');
    const link = buildEmailLink(
      { appBaseUrl: 'http://localhost:3000', headerHost: undefined },
      `/invites/${encoded}`,
    );
    expect(link).toBe('http://localhost:3000/invites/raw%2Ftok');
  });

  it('concatenates path verbatim (no extra separator, no implicit query)', () => {
    const link = buildEmailLink(
      { appBaseUrl: 'https://app.example.com', headerHost: undefined },
      '/verify-email/abc',
    );
    expect(link).toBe('https://app.example.com/verify-email/abc');
  });
});
