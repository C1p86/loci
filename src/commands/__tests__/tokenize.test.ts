// src/commands/__tests__/tokenize.test.ts

import { describe, expect, it } from 'vitest';
import { CommandSchemaError } from '../../errors.js';
import { tokenize } from '../tokenize.js';

describe('tokenize', () => {
  it('splits a simple command on whitespace', () => {
    expect(tokenize('npm run build', 'build')).toEqual(['npm', 'run', 'build']);
  });

  it('preserves double-quoted segment as a single token', () => {
    expect(tokenize('echo "hello world"', 'greet')).toEqual(['echo', 'hello world']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('', 'empty')).toEqual([]);
  });

  it('trims leading and trailing whitespace', () => {
    expect(tokenize('  a   b  ', 'trim')).toEqual(['a', 'b']);
  });

  it('handles quoted segment between other tokens', () => {
    expect(tokenize('a "b c" d', 'middle')).toEqual(['a', 'b c', 'd']);
  });

  it('throws CommandSchemaError for unclosed double quote', () => {
    expect(() => tokenize('unclosed "quote here', 'broken')).toThrowError(CommandSchemaError);
  });

  it('returns single-element array for a single word', () => {
    expect(tokenize('single', 'cmd')).toEqual(['single']);
  });

  it('collapses multiple consecutive spaces', () => {
    expect(tokenize('a   b', 'spaces')).toEqual(['a', 'b']);
  });

  it('handles tab whitespace as delimiter', () => {
    expect(tokenize('a\tb', 'tabs')).toEqual(['a', 'b']);
  });
});
