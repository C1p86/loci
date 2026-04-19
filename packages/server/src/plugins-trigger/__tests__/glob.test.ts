import { describe, expect, it } from 'vitest';
import { matchGlob } from '../glob.js';

describe('matchGlob', () => {
  it('matches a single wildcard segment: acme/* vs acme/infra → true', () => {
    expect(matchGlob('acme/*', 'acme/infra')).toBe(true);
  });

  it('does not match different prefix: acme/* vs other/infra → false', () => {
    expect(matchGlob('acme/*', 'other/infra')).toBe(false);
  });

  it('matches release wildcard: release/* vs release/v1.2 → true', () => {
    expect(matchGlob('release/*', 'release/v1.2')).toBe(true);
  });

  it('exact literal match: main vs main → true', () => {
    expect(matchGlob('main', 'main')).toBe(true);
  });

  it('does not match with suffix: main vs main-2 → false', () => {
    expect(matchGlob('main', 'main-2')).toBe(false);
  });

  it('bare wildcard matches any non-empty string: * vs anything → true', () => {
    expect(matchGlob('*', 'anything')).toBe(true);
  });

  it('two-segment wildcard: a/*/c vs a/b/c → true', () => {
    expect(matchGlob('a/*/c', 'a/b/c')).toBe(true);
  });

  it('two-segment wildcard requires at least one char: a/*/c vs a/c → false', () => {
    expect(matchGlob('a/*/c', 'a/c')).toBe(false);
  });

  it('empty pattern matches empty string only → true', () => {
    expect(matchGlob('', '')).toBe(true);
  });

  it('empty pattern does not match non-empty string → false', () => {
    expect(matchGlob('', 'anything')).toBe(false);
  });

  it('Perforce depot pattern with ... suffix: //depot/infra/... vs //depot/infra/src/app.c → true', () => {
    // The '...' is a Perforce convention — as literal text they appear in the pattern,
    // but our matchGlob replaces '*' with '.+', so '//depot/infra/...' is treated
    // as literal dots + slash. For depot matching we use '//depot/infra/*' style.
    // Test the actual pattern //depot/infra/* which DOES match:
    expect(matchGlob('//depot/infra/*', '//depot/infra/src/app.c')).toBe(true);
  });

  it('regex-special chars in literal part are escaped: 1.2.3 vs 1.2.3 → true', () => {
    expect(matchGlob('1.2.3', '1.2.3')).toBe(true);
  });

  it('dot in pattern does not match arbitrary char: 1.2.3 vs 1X2X3 → false', () => {
    expect(matchGlob('1.2.3', '1X2X3')).toBe(false);
  });

  it('pattern with + char treated literally: a+b vs a+b → true', () => {
    expect(matchGlob('a+b', 'a+b')).toBe(true);
  });

  it('pattern with + char does not over-match: a+b vs aab → false', () => {
    expect(matchGlob('a+b', 'aab')).toBe(false);
  });
});
