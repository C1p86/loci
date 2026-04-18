import { describe, expect, it } from 'vitest';
import {
  parseYaml,
  resolvePlaceholders,
  suggest,
  validateAliasRefs,
  validateCommandMap,
} from '../index.js';

describe('dsl facade', () => {
  it('parseYaml returns CommandMap for valid YAML', () => {
    const { commands, errors } = parseYaml('build:\n  cmd: npm run build\n');
    expect(errors).toHaveLength(0);
    expect(commands.has('build')).toBe(true);
  });

  it('parseYaml returns structured errors for YAML syntax failure', () => {
    const { commands, errors } = parseYaml('build:\n  cmd: [unclosed');
    expect(errors.length).toBeGreaterThan(0);
    expect(commands.size).toBe(0);
  });

  it('parseYaml rejects non-mapping root', () => {
    const { errors } = parseYaml('- item1\n- item2');
    expect(errors[0]?.message).toContain('mapping');
  });

  it('validateCommandMap detects cycles', () => {
    const { commands } = parseYaml('a:\n  steps: [b]\nb:\n  steps: [a]\n');
    const { ok, errors } = validateCommandMap(commands);
    expect(ok).toBe(false);
    expect(errors[0]?.message.toLowerCase()).toMatch(/circular|cycle/);
  });

  it('validateAliasRefs flags unknown alias references with did-you-mean', () => {
    const { commands } = parseYaml('lint:\n  cmd: biome check\nci:\n  steps: [linttt]\n');
    const errs = validateAliasRefs(commands);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]?.suggestion).toContain('lint');
  });

  it('resolvePlaceholders leaves unknown vars as-is (lenient)', () => {
    const out = resolvePlaceholders(['hello', '${NAME}', '${UNKNOWN}'], { NAME: 'world' });
    expect(out).toEqual(['hello', 'world', '${UNKNOWN}']);
  });

  it('suggest returns closest match under threshold', () => {
    expect(suggest('DATABAZE_URL', ['DATABASE_URL', 'DEBUG', 'NODE_ENV'])).toEqual([
      'DATABASE_URL',
    ]);
  });
});
