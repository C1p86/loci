import { describe, expect, it } from 'vitest';
import { MissingParamsError } from '../../errors.js';
import type { CommandDef, CommandMap } from '../../types.js';
import { validateParams } from '../params.js';

function mkCmd(argv: readonly string[]): CommandDef {
  return { kind: 'single', cmd: argv } as CommandDef;
}

describe('extractPlaceholders (via validateParams) — nested & brace-balanced', () => {
  it('reports missing inner placeholder in nested expression with map modifier', () => {
    const commands: CommandMap = new Map<string, CommandDef>([
      ['task', mkCmd(['echo', '${A.${Inner}|map:P=}'])],
    ]);
    let captured: unknown;
    try {
      validateParams('task', commands, {});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(MissingParamsError);
    expect((captured as Error).message).toMatch(/Inner/);
  });

  it('passes when inner placeholder is provided (outer resolved at runtime via JSON path)', () => {
    const commands: CommandMap = new Map<string, CommandDef>([
      ['task', mkCmd(['echo', '${A.${Inner}|map:P=}'])],
    ]);
    const values = { Inner: 'x', A: '{"x":["v1","v2"]}' };
    expect(() => validateParams('task', commands, values)).not.toThrow();
  });

  it('strips top-level pipe modifier before reporting missing', () => {
    const commands: CommandMap = new Map<string, CommandDef>([
      ['task', mkCmd(['echo', '${Simple|join:,}'])],
    ]);
    let captured: unknown;
    try {
      validateParams('task', commands, {});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(MissingParamsError);
    const msg = (captured as Error).message;
    expect(msg).toMatch(/Simple/);
    expect(msg).not.toMatch(/\|/);
  });

  it('reports multiple top-level placeholders in one token', () => {
    const commands: CommandMap = new Map<string, CommandDef>([
      ['task', mkCmd(['--a', '${A}', '--b', '${B}'])],
    ]);
    let captured: unknown;
    try {
      validateParams('task', commands, {});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(MissingParamsError);
    const msg = (captured as Error).message;
    expect(msg).toMatch(/\bA\b/);
    expect(msg).toMatch(/\bB\b/);
  });

  it('unclosed brace does not crash the validator', () => {
    const commands: CommandMap = new Map<string, CommandDef>([
      ['task', mkCmd(['echo', '${Unclosed'])],
    ]);
    expect(() => validateParams('task', commands, {})).not.toThrow();
  });

  it('$${...} escape does not extract a placeholder', () => {
    const commands: CommandMap = new Map<string, CommandDef>([
      ['task', mkCmd(['echo', '$${NotAPlaceholder}'])],
    ]);
    expect(() => validateParams('task', commands, {})).not.toThrow();
  });
});
