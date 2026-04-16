// src/executor/__tests__/capture.test.ts

import { describe, expect, it } from 'vitest';
import { validateCapture } from '../capture.js';

describe('validateCapture — type coercion', () => {
  it('string type accepts any value', () => {
    const r = validateCapture('hello', { var: 'x' });
    expect(r.valid).toBe(true);
    expect(r.coerced).toBe('hello');
  });

  it('string type trims whitespace', () => {
    const r = validateCapture('  hello  \n', { var: 'x' });
    expect(r.valid).toBe(true);
    expect(r.coerced).toBe('hello');
  });

  it('int type accepts valid integer', () => {
    const r = validateCapture('42', { var: 'x', type: 'int' });
    expect(r.valid).toBe(true);
    expect(r.coerced).toBe('42');
  });

  it('int type rejects non-integer', () => {
    const r = validateCapture('3.14', { var: 'x', type: 'int' });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('expected int');
  });

  it('int type rejects non-numeric string', () => {
    const r = validateCapture('abc', { var: 'x', type: 'int' });
    expect(r.valid).toBe(false);
  });

  it('int type rejects empty string', () => {
    const r = validateCapture('', { var: 'x', type: 'int' });
    expect(r.valid).toBe(false);
  });

  it('float type accepts decimal', () => {
    const r = validateCapture('3.14', { var: 'x', type: 'float' });
    expect(r.valid).toBe(true);
    expect(r.coerced).toBe('3.14');
  });

  it('float type accepts integer', () => {
    const r = validateCapture('42', { var: 'x', type: 'float' });
    expect(r.valid).toBe(true);
  });

  it('float type rejects non-numeric', () => {
    const r = validateCapture('abc', { var: 'x', type: 'float' });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('expected float');
  });
});

describe('validateCapture — assertions', () => {
  it('"not empty" passes for non-empty string', () => {
    const r = validateCapture('hello', { var: 'x', assert: 'not empty' });
    expect(r.valid).toBe(true);
  });

  it('"not empty" fails for empty string', () => {
    const r = validateCapture('', { var: 'x', assert: 'not empty' });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('empty');
  });

  it('"not null" passes for non-empty string', () => {
    const r = validateCapture('x', { var: 'v', assert: 'not null' });
    expect(r.valid).toBe(true);
  });

  it('"not null" fails for empty string', () => {
    const r = validateCapture('', { var: 'v', assert: 'not null' });
    expect(r.valid).toBe(false);
  });

  it('"== value" passes for matching string', () => {
    const r = validateCapture('ok', { var: 'x', assert: '== ok' });
    expect(r.valid).toBe(true);
  });

  it('"== value" fails for non-matching string', () => {
    const r = validateCapture('fail', { var: 'x', assert: '== ok' });
    expect(r.valid).toBe(false);
  });

  it('"!= value" passes for different string', () => {
    const r = validateCapture('other', { var: 'x', assert: '!= error' });
    expect(r.valid).toBe(true);
  });

  it('"!= value" fails for matching string', () => {
    const r = validateCapture('error', { var: 'x', assert: '!= error' });
    expect(r.valid).toBe(false);
  });
});

describe('validateCapture — numeric assertions', () => {
  it('"> 0" passes for positive int', () => {
    const r = validateCapture('5', { var: 'x', type: 'int', assert: '> 0' });
    expect(r.valid).toBe(true);
  });

  it('"> 0" fails for zero', () => {
    const r = validateCapture('0', { var: 'x', type: 'int', assert: '> 0' });
    expect(r.valid).toBe(false);
  });

  it('"< 100" passes for 50', () => {
    const r = validateCapture('50', { var: 'x', type: 'int', assert: '< 100' });
    expect(r.valid).toBe(true);
  });

  it('">= 0" passes for zero', () => {
    const r = validateCapture('0', { var: 'x', type: 'int', assert: '>= 0' });
    expect(r.valid).toBe(true);
  });

  it('"<= 10" fails for 11', () => {
    const r = validateCapture('11', { var: 'x', type: 'int', assert: '<= 10' });
    expect(r.valid).toBe(false);
  });

  it('"== 42" passes for 42', () => {
    const r = validateCapture('42', { var: 'x', type: 'int', assert: '== 42' });
    expect(r.valid).toBe(true);
  });

  it('"!= 0" passes for non-zero', () => {
    const r = validateCapture('1', { var: 'x', type: 'int', assert: '!= 0' });
    expect(r.valid).toBe(true);
  });
});

describe('validateCapture — multiple assertions', () => {
  it('passes when all assertions pass', () => {
    const r = validateCapture('50', {
      var: 'x',
      type: 'int',
      assert: ['>= 0', '<= 100'],
    });
    expect(r.valid).toBe(true);
  });

  it('fails when any assertion fails', () => {
    const r = validateCapture('150', {
      var: 'x',
      type: 'int',
      assert: ['>= 0', '<= 100'],
    });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('100');
  });
});

describe('validateCapture — regex assertion', () => {
  it('"matches /pattern/" passes when value matches', () => {
    const r = validateCapture('abc-123', { var: 'x', assert: 'matches /^[a-z]+-\\d+$/' });
    expect(r.valid).toBe(true);
  });

  it('"matches /pattern/" fails when value does not match', () => {
    const r = validateCapture('INVALID', { var: 'x', assert: 'matches /^[a-z]+$/' });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('does not match');
  });
});

describe('validateCapture — json type', () => {
  it('json type accepts valid JSON object', () => {
    const r = validateCapture('{"key": "value"}', { var: 'x', type: 'json' });
    expect(r.valid).toBe(true);
  });

  it('json type accepts valid JSON array', () => {
    const r = validateCapture('[1, 2, 3]', { var: 'x', type: 'json' });
    expect(r.valid).toBe(true);
  });

  it('json type accepts valid JSON string', () => {
    const r = validateCapture('"hello"', { var: 'x', type: 'json' });
    expect(r.valid).toBe(true);
  });

  it('json type rejects invalid JSON', () => {
    const r = validateCapture('{not json}', { var: 'x', type: 'json' });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('expected valid JSON');
  });

  it('json type rejects empty string', () => {
    const r = validateCapture('', { var: 'x', type: 'json' });
    expect(r.valid).toBe(false);
  });
});

describe('validateCapture — json assertions', () => {
  it('"valid json" passes for valid JSON', () => {
    const r = validateCapture('{"a": 1}', { var: 'x', assert: 'valid json' });
    expect(r.valid).toBe(true);
  });

  it('"valid json" fails for invalid JSON', () => {
    const r = validateCapture('not json', { var: 'x', assert: 'valid json' });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('expected valid JSON');
  });

  it('"valid json" fails for empty string', () => {
    const r = validateCapture('', { var: 'x', assert: 'valid json' });
    expect(r.valid).toBe(false);
  });

  it('"valid json or empty" passes for valid JSON', () => {
    const r = validateCapture('[1, 2]', { var: 'x', assert: 'valid json or empty' });
    expect(r.valid).toBe(true);
  });

  it('"valid json or empty" passes for empty string', () => {
    const r = validateCapture('', { var: 'x', assert: 'valid json or empty' });
    expect(r.valid).toBe(true);
  });

  it('"valid json or empty" fails for invalid non-empty string', () => {
    const r = validateCapture('not json', { var: 'x', assert: 'valid json or empty' });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('expected valid JSON or empty');
  });
});
