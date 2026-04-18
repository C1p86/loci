// D-05: re-export facade; no business logic.
// D-12 step 1-2: YAML parse + structural normalize (errors collected, never thrown).
// Pitfall 4: import normalizeCommands DIRECTLY from ../commands/normalize.js — NOT from
// ../commands/index.js (that module pulls in the whole config stack and bloats dsl.mjs).
import { parse, YAMLParseError as YamlLibError } from 'yaml';
import { normalizeCommands } from '../commands/normalize.js';
import type { CommandMap } from '../types.js';
import type { ParseError } from './types.js';

export interface ParseResult {
  commands: CommandMap;
  errors: ParseError[];
}

export function parseYaml(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    const linePos = err instanceof YamlLibError ? err.linePos?.[0] : undefined;
    const parseError: import('./types.js').ParseError = {
      message: err instanceof Error ? err.message : String(err),
    };
    if (linePos !== undefined) {
      parseError.line = linePos.line;
      parseError.column = linePos.col;
    }
    return {
      commands: new Map(),
      errors: [parseError],
    };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      commands: new Map(),
      errors: [{ message: 'YAML root must be a mapping of alias -> command definition' }],
    };
  }
  try {
    const commands = normalizeCommands(raw as Record<string, unknown>, '<server-yaml>');
    return { commands, errors: [] };
  } catch (err) {
    return {
      commands: new Map(),
      errors: [{ message: err instanceof Error ? err.message : String(err) }],
    };
  }
}
