// src/commands/tokenize.ts
//
// Whitespace tokenizer with double-quote preservation (D-03).
// Splits a command string into argv tokens without invoking a shell.

import { CommandSchemaError } from '../errors.js';

/**
 * Split a command string into argv tokens.
 *
 * Rules:
 * - Whitespace (space, tab, newline) between tokens acts as a delimiter.
 * - Consecutive whitespace is treated as a single delimiter.
 * - Double-quoted segments are treated as a single token (quotes stripped).
 * - Unclosed double quotes throw CommandSchemaError.
 * - Empty input returns [].
 */
export function tokenize(input: string, aliasName: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === '"') {
      if (!inQuotes) {
        inQuotes = true;
      } else {
        inQuotes = false;
      }
    } else if (!inQuotes && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r')) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (inQuotes) {
    throw new CommandSchemaError(aliasName, 'unclosed double quote in command string');
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
