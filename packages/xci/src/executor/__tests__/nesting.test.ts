// src/executor/__tests__/nesting.test.ts
//
// Unit tests for getNestingDepth / isNested (executor/nesting.ts).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { XCI_NESTING_DEPTH_ENV, getNestingDepth, isNested } from '../nesting.js';

const ORIG = process.env[XCI_NESTING_DEPTH_ENV];

afterEach(() => {
  // Restore the original value (or delete if unset)
  if (ORIG === undefined) {
    delete process.env[XCI_NESTING_DEPTH_ENV];
  } else {
    process.env[XCI_NESTING_DEPTH_ENV] = ORIG;
  }
});

describe('getNestingDepth', () => {
  it('returns 0 when env var is unset', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    expect(getNestingDepth()).toBe(0);
  });

  it('returns 0 when env var is "0"', () => {
    process.env[XCI_NESTING_DEPTH_ENV] = '0';
    expect(getNestingDepth()).toBe(0);
  });

  it('returns 1 when env var is "1"', () => {
    process.env[XCI_NESTING_DEPTH_ENV] = '1';
    expect(getNestingDepth()).toBe(1);
  });

  it('returns 3 when env var is "3"', () => {
    process.env[XCI_NESTING_DEPTH_ENV] = '3';
    expect(getNestingDepth()).toBe(3);
  });

  it('returns 0 for NaN (non-numeric string)', () => {
    process.env[XCI_NESTING_DEPTH_ENV] = 'abc';
    expect(getNestingDepth()).toBe(0);
  });

  it('clamps negative values to 0', () => {
    process.env[XCI_NESTING_DEPTH_ENV] = '-5';
    expect(getNestingDepth()).toBe(0);
  });
});

describe('isNested', () => {
  it('returns false when depth is 0 (unset)', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    expect(isNested()).toBe(false);
  });

  it('returns false when depth is "0"', () => {
    process.env[XCI_NESTING_DEPTH_ENV] = '0';
    expect(isNested()).toBe(false);
  });

  it('returns true when depth is "1"', () => {
    process.env[XCI_NESTING_DEPTH_ENV] = '1';
    expect(isNested()).toBe(true);
  });

  it('returns true when depth is "3"', () => {
    process.env[XCI_NESTING_DEPTH_ENV] = '3';
    expect(isNested()).toBe(true);
  });

  it('returns false for NaN depth', () => {
    process.env[XCI_NESTING_DEPTH_ENV] = 'abc';
    expect(isNested()).toBe(false);
  });
});
