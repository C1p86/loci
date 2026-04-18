import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, argon2SelfTest } from '../password.js';

describe('hashPassword / verifyPassword (D-31)', () => {
  it('produces an argon2id encoded hash with m=19456,t=2,p=1', async () => {
    const h = await hashPassword('correct-horse-battery-staple');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('verifyPassword returns true for correct password', async () => {
    const pw = 'correct-horse-battery-staple';
    const h = await hashPassword(pw);
    expect(await verifyPassword(h, pw)).toBe(true);
  });

  it('verifyPassword returns false for wrong password', async () => {
    const h = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword(h, 'wrong-password')).toBe(false);
  });

  it('verifyPassword returns false for malformed hash (no throw)', async () => {
    expect(await verifyPassword('not-a-valid-hash', 'anything')).toBe(false);
  });

  it('two hashes of the same password are different (random salt)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });
}, 60_000); // argon2 hashes take ~500ms each; 5 tests × ~500ms = ~2.5s; headroom to 60s

describe('argon2SelfTest (Pitfall 3 warmup)', () => {
  it('calls logger.info when hash time is in normal range', async () => {
    const calls: Array<{ level: 'info' | 'warn'; obj: object; msg: string }> = [];
    const logger = {
      info: (obj: object, msg: string) => calls.push({ level: 'info', obj, msg }),
      warn: (obj: object, msg: string) => calls.push({ level: 'warn', obj, msg }),
    };
    await argon2SelfTest(logger);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.obj).toHaveProperty('elapsedMs');
    // Most hardware: info (100-2000ms). Very slow CI: warn. Either is acceptable.
    expect(['info', 'warn']).toContain(calls[0]?.level);
  });
}, 30_000);
