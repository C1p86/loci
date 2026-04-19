// packages/xci/src/agent/__tests__/runner.test.ts
// Unit tests for:
//   - redactLine: value replacement, longest-first ordering, undefined/empty pass-through
//   - splitChunk: 8KB boundary, empty input, codepoint safety (emoji straddle)
//   - spawnTask integration with redactionValues (no secret survives; seq contiguous from 0)

import { describe, expect, it } from 'vitest';
import { redactLine, splitChunk, spawnTask } from '../runner.js';

describe('redactLine', () => {
  it('replaces a value with ***', () => {
    expect(redactLine('hello secret-abc world', ['secret-abc'])).toBe('hello *** world');
  });

  it('replaces multiple occurrences of the same value', () => {
    expect(redactLine('secret-abc prefix secret-abc suffix', ['secret-abc'])).toBe(
      '*** prefix *** suffix',
    );
  });

  it('longest-first wins: aaaa replaced as whole unit not as 4 × a', () => {
    // Without longest-first, 'aaaa' matches 'a' four times → '***' + '***' + '***' + '***'
    // With longest-first, 'aaaa' is replaced in one shot → '***'
    expect(redactLine('aaaa', ['a', 'aaaa'])).toBe('***');
  });

  it('no-op on undefined values', () => {
    expect(redactLine('hello world', undefined)).toBe('hello world');
  });

  it('no-op on empty values array', () => {
    expect(redactLine('hello world', [])).toBe('hello world');
  });

  it('replaces all values in the line', () => {
    expect(redactLine('token=abc123 key=xyz789', ['abc123', 'xyz789'])).toBe(
      'token=*** key=***',
    );
  });
});

describe('splitChunk', () => {
  it('empty input → []', () => {
    expect(splitChunk('', 8192)).toEqual([]);
  });

  it('short string → [data] single piece', () => {
    expect(splitChunk('hi', 8192)).toEqual(['hi']);
  });

  it('exactly maxBytes → single piece', () => {
    // Build a string that is exactly 8192 bytes in UTF-8 (using ASCII)
    const data = 'a'.repeat(8192);
    const pieces = splitChunk(data, 8192);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toBe(data);
  });

  it('maxBytes+1 bytes → 2 pieces', () => {
    // 8193 ASCII chars → 2 pieces: [8192, 1]
    const data = 'a'.repeat(8193);
    const pieces = splitChunk(data, 8192);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toBe('a'.repeat(8192));
    expect(pieces[1]).toBe('a');
  });

  it('N*maxBytes → N pieces of exactly maxBytes each', () => {
    const K = 2;
    const data = 'a'.repeat(8192 * K);
    const pieces = splitChunk(data, 8192);
    expect(pieces).toHaveLength(K);
    for (const piece of pieces) {
      expect(Buffer.byteLength(piece, 'utf8')).toBe(8192);
    }
  });

  it('does not split a 4-byte UTF-8 codepoint (emoji) across pieces', () => {
    // 🚀 is 4 bytes in UTF-8; build 8191 ASCII bytes + 1 emoji
    // → total 8195 bytes. The splitter must NOT put 1 byte of the emoji in piece 0
    //   and 3 bytes in piece 1 (which would be invalid UTF-8 / corrupted string).
    // Expected: either 1 piece (8195 bytes) OR 2 pieces where piece[0] is 8191 bytes
    //   (stopping before the emoji) and piece[1] is the emoji alone.
    const emoji = '🚀'; // 4 bytes
    const data = 'a'.repeat(8191) + emoji;
    const pieces = splitChunk(data, 8192);
    // Reassembled text must equal original
    expect(pieces.join('')).toBe(data);
    // Each piece must be valid UTF-8 (no split mid-codepoint)
    for (const piece of pieces) {
      expect(() => Buffer.from(piece, 'utf8').toString('utf8')).not.toThrow();
      // The emoji must be intact — not split
      if (piece.includes('🚀')) {
        expect(piece.endsWith('🚀')).toBe(true);
      }
    }
    // No single piece exceeds maxBytes
    for (const piece of pieces) {
      expect(Buffer.byteLength(piece, 'utf8')).toBeLessThanOrEqual(8192);
    }
  });

  it('multi-emoji string reassembles losslessly', () => {
    // 2000 emojis (each 4 bytes = 8000 bytes) — fits in a single piece
    const data = '🚀'.repeat(2000);
    const pieces = splitChunk(data, 8192);
    expect(pieces.join('')).toBe(data);
  });
});

describe('spawnTask integration with redactionValues', () => {
  it(
    'emits redacted chunks; no secret substring appears anywhere; seq contiguous from 0',
    async () => {
      const received: Array<{ stream: string; data: string; seq: number }> = [];

      await new Promise<void>((resolve) => {
        spawnTask('run-test-1', {
          argv: [
            process.execPath,
            '-e',
            'process.stdout.write("secret-abc".repeat(2000));',
          ],
          cwd: process.cwd(),
          env: process.env as Record<string, string>,
          redactionValues: ['secret-abc'],
          onChunk: (stream, data, seq) => received.push({ stream, data, seq }),
          onExit: () => resolve(),
        });
      });

      // No emitted chunk should contain the raw secret
      expect(
        received.every((r) => !r.data.includes('secret-abc')),
        `Secret found in chunks: ${received.filter((r) => r.data.includes('secret-abc')).map((r) => r.data.slice(0, 80)).join(' | ')}`,
      ).toBe(true);

      // All chunks should contain only *** (the replacement)
      const allData = received.map((r) => r.data).join('');
      expect(allData).not.toContain('secret-abc');

      // Seq numbers must be contiguous starting from 0
      for (let i = 0; i < received.length; i++) {
        expect(received[i]!.seq, `seq at index ${i} should be ${i}`).toBe(i);
      }

      // At least one chunk was received
      expect(received.length).toBeGreaterThan(0);
    },
    15_000,
  );

  it('chunks are split at 8KB boundary when output is large', async () => {
    const received: Array<{ stream: string; data: string; seq: number }> = [];

    // Write 20000 bytes in a single stdout.write — should be split into at least 3 chunks of 8KB
    await new Promise<void>((resolve) => {
      spawnTask('run-test-2', {
        argv: [
          process.execPath,
          '-e',
          `process.stdout.write('x'.repeat(20000));`,
        ],
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
        onChunk: (stream, data, seq) => received.push({ stream, data, seq }),
        onExit: () => resolve(),
      });
    });

    // All pieces ≤ 8192 bytes
    for (const r of received) {
      expect(Buffer.byteLength(r.data, 'utf8')).toBeLessThanOrEqual(8192);
    }

    // Seq contiguous from 0
    for (let i = 0; i < received.length; i++) {
      expect(received[i]!.seq).toBe(i);
    }

    // Total bytes assembled equals 20000
    const total = received.reduce((acc, r) => acc + Buffer.byteLength(r.data, 'utf8'), 0);
    expect(total).toBe(20000);
  }, 15_000);
});
