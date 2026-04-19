// Unit tests for services/dispatch-resolver.ts
// Pure function: D-33 / D-34 precedence (runOverrides > orgSecrets > unresolved).
// No side effects — no DB, no logger, no network.

import { describe, expect, it } from 'vitest';
import type { ResolveInput } from '../dispatch-resolver.js';
import { resolveTaskParams } from '../dispatch-resolver.js';

function makeTask(yamlDefinition: string): ResolveInput['task'] {
  return { id: 'xci_tsk_test', name: 'test-task', yamlDefinition };
}

describe('resolveTaskParams', () => {
  it('substitutes orgSecrets value when placeholder present', () => {
    const input: ResolveInput = {
      task: makeTask('run: echo ${API_KEY}'),
      runOverrides: {},
      orgSecrets: { API_KEY: 'abc-secret' },
    };
    const result = resolveTaskParams(input);
    expect(result.resolvedYaml).toBe('run: echo abc-secret');
    expect(result.unresolved).toEqual([]);
  });

  it('runOverrides beats orgSecrets on collision (D-34 precedence)', () => {
    const input: ResolveInput = {
      task: makeTask('run: deploy ${API_KEY}'),
      runOverrides: { API_KEY: 'override-value' },
      orgSecrets: { API_KEY: 'secret-value' },
    };
    const result = resolveTaskParams(input);
    expect(result.resolvedYaml).toBe('run: deploy override-value');
    expect(result.unresolved).toEqual([]);
  });

  it('unknown placeholder stays as-is and is reported in unresolved', () => {
    const input: ResolveInput = {
      task: makeTask('run: echo ${UNKNOWN_VAR}'),
      runOverrides: {},
      orgSecrets: {},
    };
    const result = resolveTaskParams(input);
    expect(result.resolvedYaml).toBe('run: echo ${UNKNOWN_VAR}');
    expect(result.unresolved).toContain('UNKNOWN_VAR');
    expect(result.unresolved).toHaveLength(1);
  });

  it('multiple placeholders: mixed resolved and unresolved', () => {
    const input: ResolveInput = {
      task: makeTask('run: ${A} ${B}'),
      runOverrides: { A: 'resolved-a' },
      orgSecrets: {},
    };
    const result = resolveTaskParams(input);
    expect(result.resolvedYaml).toBe('run: resolved-a ${B}');
    expect(result.unresolved).toContain('B');
    expect(result.unresolved).not.toContain('A');
  });

  it('pure: same input twice returns same output', () => {
    const input: ResolveInput = {
      task: makeTask('cmd: ${KEY}'),
      runOverrides: { KEY: 'val' },
      orgSecrets: {},
    };
    const r1 = resolveTaskParams(input);
    const r2 = resolveTaskParams(input);
    expect(r1.resolvedYaml).toBe(r2.resolvedYaml);
    expect(r1.unresolved).toEqual(r2.unresolved);
  });

  it('pure: does not mutate runOverrides or orgSecrets', () => {
    const runOverrides = { A: 'a-val' };
    const orgSecrets = { B: 'b-val' };
    const overridesBefore = JSON.stringify(runOverrides);
    const secretsBefore = JSON.stringify(orgSecrets);

    resolveTaskParams({
      task: makeTask('${A} ${B} ${C}'),
      runOverrides,
      orgSecrets,
    });

    expect(JSON.stringify(runOverrides)).toBe(overridesBefore);
    expect(JSON.stringify(orgSecrets)).toBe(secretsBefore);
  });

  it('empty runOverrides and orgSecrets with no placeholders returns yaml unchanged', () => {
    const yaml = 'run: echo hello-world';
    const result = resolveTaskParams({
      task: makeTask(yaml),
      runOverrides: {},
      orgSecrets: {},
    });
    expect(result.resolvedYaml).toBe(yaml);
    expect(result.unresolved).toEqual([]);
  });

  it('repeated placeholder is only listed once in unresolved', () => {
    const result = resolveTaskParams({
      task: makeTask('${X} and again ${X}'),
      runOverrides: {},
      orgSecrets: {},
    });
    // Both occurrences replaced with ${X} (unresolved), name reported once
    expect(result.unresolved).toEqual(['X']);
  });
});
