import { describe, expect, it } from 'vitest';
import { compareToken, generateId, generateToken, hashToken } from '../tokens.js';

describe('generateToken (D-33)', () => {
  it('returns a 43-char base64url string (32 bytes unpadded)', () => {
    const t = generateToken();
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url alphabet, no padding
  });
  it('returns a different value each call (collision risk < 2^-128)', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) tokens.add(generateToken());
    expect(tokens.size).toBe(100);
  });
});

describe('generateId (D-25)', () => {
  it('produces xci_<prefix>_<20-char-base64url>', () => {
    const id = generateId('usr');
    expect(id).toMatch(/^xci_usr_[A-Za-z0-9_-]{20}$/);
  });
  it.each([
    'org',
    'usr',
    'mem',
    'ses',
    'inv',
    'ver',
    'pwr',
    'plan',
  ] as const)('accepts prefix %s', (p) => {
    const id = generateId(p);
    expect(id.startsWith(`xci_${p}_`)).toBe(true);
  });
  it('100 calls return 100 unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(generateId('usr'));
    expect(ids.size).toBe(100);
  });
});

describe('compareToken (ATOK-06)', () => {
  it('returns true for equal strings', () => {
    expect(compareToken('abc', 'abc')).toBe(true);
  });
  it('returns false for equal-length different strings', () => {
    expect(compareToken('abc', 'abd')).toBe(false);
  });
  it('returns false (does not throw) for different-length strings', () => {
    expect(() => compareToken('abc', 'abcd')).not.toThrow();
    expect(compareToken('abc', 'abcd')).toBe(false);
  });
  it('returns true for empty strings', () => {
    expect(compareToken('', '')).toBe(true);
  });
});

describe('hashToken', () => {
  it('returns 64-char lowercase hex', () => {
    const h = hashToken('abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });
  it('differs for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
  it('hash is not the plaintext', () => {
    const plain = 'mysecrettoken';
    expect(hashToken(plain)).not.toBe(plain);
  });
});

describe('generateId (Phase 8 prefixes)', () => {
  it.each(['agt', 'crd', 'rtk'] as const)('generates xci_%s_... id', (prefix) => {
    const id = generateId(prefix);
    expect(id).toMatch(new RegExp(`^xci_${prefix}_[A-Za-z0-9_-]+$`));
    expect(id.length).toBeGreaterThanOrEqual(25);
  });
});
