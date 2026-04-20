// packages/xci/src/__tests__/log-errors.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { printErrorLines } from '../log-errors.js';

describe('printErrorLines', () => {
  let spy: ReturnType<typeof vi.spyOn> | undefined;

  function installSpy(): ReturnType<typeof vi.spyOn> {
    spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    return spy;
  }

  afterEach(() => {
    spy?.mockRestore();
    spy = undefined;
  });

  it('writes nothing to stderr on empty input', () => {
    const s = installSpy();
    printErrorLines('');
    expect(s.mock.calls.length).toBe(0);
  });

  it('writes nothing to stderr when no /error/i matches', () => {
    const s = installSpy();
    printErrorLines('ok\nfine\ndone');
    expect(s.mock.calls.length).toBe(0);
  });

  it('prints header, matched lines, and closing separator for 2 matches with source', () => {
    const s = installSpy();
    printErrorLines('ok\nerror: boom\nmore\nERROR!', 'task-123');
    const output = s.mock.calls.flat().join('');
    // Header contains match count + source
    expect(output).toContain('2 error line(s) in task-123');
    // Both matching lines appear
    expect(output).toContain('error: boom');
    expect(output).toContain('ERROR!');
    // Closing separator
    expect(output).toContain('---\n');
  });

  it('matches mixed case (ERROR, Error, error) — exactly 3 matched lines', () => {
    const s = installSpy();
    printErrorLines('noise\nERROR one\nError two\nerror three\nok', 'src');
    const output = s.mock.calls.flat().join('');
    expect(output).toContain('3 error line(s) in src');
    expect(output).toContain('ERROR one');
    expect(output).toContain('Error two');
    expect(output).toContain('error three');
    // Make sure unrelated lines are not in output
    expect(output).not.toContain('noise');
    expect(output).not.toContain('\nok\n');
  });

  it('truncates to 50 lines and prints "(+N more" footer when matches > 50', () => {
    const s = installSpy();
    const lines: string[] = [];
    for (let i = 0; i < 55; i++) {
      lines.push(`error ${i}`);
    }
    printErrorLines(lines.join('\n'), 'big');
    const output = s.mock.calls.flat().join('');
    // Header says 55
    expect(output).toContain('55 error line(s) in big');
    // Footer indicates 5 additional matches were truncated
    expect(output).toContain('(+5 more');
    // First 50 printed
    expect(output).toContain('error 0');
    expect(output).toContain('error 49');
    // Line 50+ NOT printed individually (only summarized in footer)
    expect(output).not.toContain('\nerror 50\n');
    expect(output).not.toContain('\nerror 54\n');
  });

  it('header omits " in ${source}" suffix when called without source', () => {
    const s = installSpy();
    printErrorLines('error: x');
    const output = s.mock.calls.flat().join('');
    expect(output).toContain('--- 1 error line(s) ---');
    // Make sure no " in undefined" slipped in
    expect(output).not.toContain('undefined');
    expect(output).not.toContain(' in ');
  });
});
