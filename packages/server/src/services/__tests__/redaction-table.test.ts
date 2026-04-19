// Phase 11 D-05/D-06/D-07 unit tests for redaction-table service.
// Tests: variants generated, longest-first ordering, min-length filter, missing table no-op.

import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildRedactionTable,
  buildRedactionVariants,
  clearRedactionTable,
  redactChunk,
} from '../redaction-table.js';

// Minimal fastify mock — only runRedactionTables field is accessed
function makeFakeFastify() {
  return {
    runRedactionTables: new Map<string, readonly string[]>(),
  } as unknown as FastifyInstance;
}

describe('buildRedactionVariants', () => {
  it('returns raw, base64, url-encoded, and hex variants for a normal value', () => {
    const variants = buildRedactionVariants('secret123');
    expect(variants).toContain('secret123');
    expect(variants).toContain(Buffer.from('secret123').toString('base64'));
    expect(variants).toContain(Buffer.from('secret123').toString('hex'));
    // URL-encoded of 'secret123' is the same as raw (no special chars) — deduplication is correct.
    // We expect at least 3 distinct variants.
    expect(variants.length).toBeGreaterThanOrEqual(3);
  });

  it('produces at least 4 variants for a value with special chars that triggers URL encoding', () => {
    // Use a value with '=' and '&' — encodeURIComponent encodes these, yielding a distinct URL variant
    const raw = 'tok=val&x1';
    const variants = buildRedactionVariants(raw);
    const b64 = Buffer.from(raw).toString('base64');
    const url = encodeURIComponent(raw); // 'tok%3Dval%26x1'
    const hex = Buffer.from(raw).toString('hex');
    expect(variants).toContain(raw);
    expect(variants).toContain(b64);
    expect(variants).toContain(url);
    expect(variants).toContain(hex);
    // All 4 should be distinct for this input
    const unique = new Set(variants);
    expect(unique.size).toBeGreaterThanOrEqual(4);
  });

  it('returns empty array for values shorter than 4 characters', () => {
    expect(buildRedactionVariants('abc')).toEqual([]);
    expect(buildRedactionVariants('ab')).toEqual([]);
    expect(buildRedactionVariants('')).toEqual([]);
  });

  it('accepts values of exactly 4 characters', () => {
    const variants = buildRedactionVariants('pass');
    expect(variants.length).toBeGreaterThan(0);
    expect(variants).toContain('pass');
  });

  it('deduplicates variants (URL-safe value that does not change with encodeURIComponent)', () => {
    // A value that is already URL-safe and base64 produces fewer distinct variants
    const variants = buildRedactionVariants('aaaa');
    const unique = new Set(variants);
    expect(unique.size).toBe(variants.length);
  });
});

describe('buildRedactionTable', () => {
  it('populates runRedactionTables with a frozen sorted array', () => {
    const fastify = makeFakeFastify();
    buildRedactionTable(fastify, 'run-001', ['secret123']);
    const table = fastify.runRedactionTables.get('run-001');
    expect(table).toBeDefined();
    expect(Object.isFrozen(table)).toBe(true);
  });

  it('orders variants longest-first (D-06: prevents partial replacement bugs)', () => {
    const fastify = makeFakeFastify();
    // Both "abcd" and "abcd1234efgh" are values; longer variant must precede shorter
    buildRedactionTable(fastify, 'run-002', ['abcd', 'abcd1234efgh']);
    const table = fastify.runRedactionTables.get('run-002')!;
    for (let i = 0; i < table.length - 1; i++) {
      expect(table[i]!.length).toBeGreaterThanOrEqual(table[i + 1]!.length);
    }
  });

  it('skips values with length < 4 (D-05 minimum length)', () => {
    const fastify = makeFakeFastify();
    buildRedactionTable(fastify, 'run-003', ['ab', 'x']);
    const table = fastify.runRedactionTables.get('run-003')!;
    // Variants of "ab" and "x" are still short; all should be filtered
    for (const v of table) {
      expect(v.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('handles empty secretValues array gracefully', () => {
    const fastify = makeFakeFastify();
    buildRedactionTable(fastify, 'run-004', []);
    const table = fastify.runRedactionTables.get('run-004')!;
    expect(table).toEqual([]);
  });
});

describe('clearRedactionTable', () => {
  it('removes the entry from runRedactionTables', () => {
    const fastify = makeFakeFastify();
    buildRedactionTable(fastify, 'run-005', ['mysecret']);
    expect(fastify.runRedactionTables.has('run-005')).toBe(true);
    clearRedactionTable(fastify, 'run-005');
    expect(fastify.runRedactionTables.has('run-005')).toBe(false);
  });

  it('is a no-op if the runId is not in the map', () => {
    const fastify = makeFakeFastify();
    // Should not throw
    expect(() => clearRedactionTable(fastify, 'nonexistent-run')).not.toThrow();
  });
});

describe('redactChunk', () => {
  it('returns data unchanged when redactions is undefined (D-07 missing table no-op)', () => {
    expect(redactChunk('hello secret', undefined)).toBe('hello secret');
  });

  it('returns data unchanged when redactions is empty array', () => {
    expect(redactChunk('hello secret', [])).toBe('hello secret');
  });

  it('replaces raw secret value with ***', () => {
    const result = redactChunk('output: mysecret value here', ['mysecret']);
    expect(result).toBe('output: *** value here');
  });

  it('replaces all variants produced by buildRedactionVariants', () => {
    const fastify = makeFakeFastify();
    buildRedactionTable(fastify, 'run-006', ['secret123']);
    const redactions = fastify.runRedactionTables.get('run-006')!;

    // Raw value should be redacted
    expect(redactChunk('raw: secret123', redactions)).toBe('raw: ***');

    // Hex variant should be redacted
    const hex = Buffer.from('secret123').toString('hex');
    expect(redactChunk(`hex: ${hex}`, redactions)).toBe('hex: ***');

    // Base64 variant should be redacted
    const b64 = Buffer.from('secret123').toString('base64');
    expect(redactChunk(`b64: ${b64}`, redactions)).toBe('b64: ***');

    // URL-encoded variant (secret123 has no special chars, same as raw)
    const url = encodeURIComponent('secret123');
    expect(redactChunk(`url: ${url}`, redactions)).toBe('url: ***');
  });

  it('longest-first ordering prevents partial replacement: "abcd1234efgh" replaced before "abcd"', () => {
    const fastify = makeFakeFastify();
    buildRedactionTable(fastify, 'run-007', ['abcd', 'abcd1234efgh']);
    const redactions = fastify.runRedactionTables.get('run-007')!;

    // If we process shortest first, "abcd" in "abcd1234efgh" gets replaced → "***1234efgh"
    // Longest-first should give us "***" (the full long secret replaced in one pass)
    const result = redactChunk('value: abcd1234efgh', redactions);
    expect(result).toBe('value: ***');
    expect(result).not.toContain('1234efgh');
  });

  it('replaces multiple occurrences in a single chunk (replaceAll semantics)', () => {
    const result = redactChunk('secret secret secret', ['secret']);
    expect(result).toBe('*** *** ***');
  });
});
