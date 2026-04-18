import { describe, it, expect } from 'vitest';
import { generateToken, generateId } from '../tokens.js';

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
  it.each(['org', 'usr', 'mem', 'ses', 'inv', 'ver', 'pwr', 'plan'] as const)('accepts prefix %s', (p) => {
    const id = generateId(p);
    expect(id.startsWith(`xci_${p}_`)).toBe(true);
  });
  it('100 calls return 100 unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(generateId('usr'));
    expect(ids.size).toBe(100);
  });
});
