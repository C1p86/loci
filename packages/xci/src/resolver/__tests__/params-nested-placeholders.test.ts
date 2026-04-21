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

/* ============================================================
 * cwd placeholder tracking (quick-260421-g99)
 * ============================================================ */

describe('validateParams — ${placeholder} inside cwd surfaces as missing param', () => {
  it('single kind: missing DEPLOY_DIR in cwd throws MissingParamsError', () => {
    const commands: CommandMap = new Map<string, CommandDef>([
      ['build', { kind: 'single', cmd: ['echo', 'hi'], cwd: '${DEPLOY_DIR}' }],
    ]);
    let captured: unknown;
    try {
      validateParams('build', commands, {});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(MissingParamsError);
    expect((captured as Error).message).toMatch(/DEPLOY_DIR/);
  });

  it('single kind: DEPLOY_DIR provided → no error', () => {
    const commands: CommandMap = new Map<string, CommandDef>([
      ['build', { kind: 'single', cmd: ['echo', 'hi'], cwd: '${DEPLOY_DIR}' }],
    ]);
    expect(() => validateParams('build', commands, { DEPLOY_DIR: 'packages/web' })).not.toThrow();
  });

  it('sequential kind: ${DEPLOY_DIR} in cwd surfaces as missing', () => {
    const commands: CommandMap = new Map<string, CommandDef>([
      ['ci', { kind: 'sequential', steps: ['echo hi'], cwd: '${DEPLOY_DIR}' }],
    ]);
    let captured: unknown;
    try {
      validateParams('ci', commands, {});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(MissingParamsError);
    expect((captured as Error).message).toMatch(/DEPLOY_DIR/);
  });

  it('parallel kind: ${DEPLOY_DIR} in cwd surfaces as missing', () => {
    const commands: CommandMap = new Map<string, CommandDef>([
      ['par', { kind: 'parallel', group: ['a'], cwd: '${DEPLOY_DIR}' }],
      ['a', { kind: 'single', cmd: ['echo', 'a'] }],
    ]);
    let captured: unknown;
    try {
      validateParams('par', commands, {});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(MissingParamsError);
    expect((captured as Error).message).toMatch(/DEPLOY_DIR/);
  });

  it('for_each kind: ${DEPLOY_DIR} in cwd surfaces as missing', () => {
    const commands: CommandMap = new Map<string, CommandDef>([
      ['fe', {
        kind: 'for_each',
        var: 'x',
        in: ['a'],
        mode: 'steps',
        cmd: ['echo', '${x}'],
        cwd: '${DEPLOY_DIR}',
      }],
    ]);
    let captured: unknown;
    try {
      validateParams('fe', commands, {});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(MissingParamsError);
    expect((captured as Error).message).toMatch(/DEPLOY_DIR/);
  });

  it('ini kind: ${DEPLOY_DIR} in cwd surfaces as missing', () => {
    const commands: CommandMap = new Map<string, CommandDef>([
      ['cfg', {
        kind: 'ini',
        file: 'x.ini',
        set: { Sec: { k: 'v' } },
        cwd: '${DEPLOY_DIR}',
      }],
    ]);
    let captured: unknown;
    try {
      validateParams('cfg', commands, {});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(MissingParamsError);
    expect((captured as Error).message).toMatch(/DEPLOY_DIR/);
  });
});
