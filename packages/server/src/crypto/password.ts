import { hash, verify } from '@node-rs/argon2';

/**
 * OWASP 2024 Argon2id params (D-31).
 * Source: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 *
 * Algorithm.Argon2id = 2 (const enum — cannot import with verbatimModuleSyntax; use literal).
 * Stable value per @node-rs/argon2 index.d.ts.
 */
const ARGON2_OPTS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  algorithm: 2, // Algorithm.Argon2id — literal required by verbatimModuleSyntax
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  try {
    return await verify(encoded, password, ARGON2_OPTS);
  } catch {
    // Malformed encoded hash → constant-time false (don't leak parse errors)
    return false;
  }
}

/**
 * D-31 Specifics (Pitfall 3): warmup hash at server boot to avoid event-loop
 * stall on first signup. Also times the hash and warns if params are out of range.
 */
export async function argon2SelfTest(logger: {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}): Promise<void> {
  const start = performance.now();
  await hashPassword('xci-warmup-benchmark-not-a-real-password');
  const elapsed = performance.now() - start;
  if (elapsed < 100) {
    logger.warn(
      { elapsedMs: Math.round(elapsed) },
      'argon2 self-test: hash too fast, consider stronger params',
    );
  } else if (elapsed > 2000) {
    logger.warn(
      { elapsedMs: Math.round(elapsed) },
      'argon2 self-test: hash too slow, will starve event loop under load',
    );
  } else {
    logger.info({ elapsedMs: Math.round(elapsed) }, 'argon2 self-test: hash timing OK');
  }
}
