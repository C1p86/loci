// Phase 9 D-33 + D-34: pure function Phase 10 dispatcher will call.
// Merges runOverrides (per-run UI values) + orgSecrets (decrypted at dispatch time)
// with precedence runOverrides > orgSecrets > unresolved (left for agent-side .xci/secrets.yml).
//
// INVARIANTS:
// - No DB access, no logger, no side effects.
// - Inputs are never mutated.
// - Unknown ${VAR} placeholders stay as-is in resolvedYaml and are listed in unresolved[].
//   The agent's existing .xci/secrets.yml merge (SEC-06) handles them at runtime.

export interface ResolveInput {
  /** Minimal task fields needed for resolution. */
  task: {
    id: string;
    name: string;
    /** Raw YAML text storing the task definition. */
    yamlDefinition: string;
  };
  /** Per-run parameter overrides from UI. Wins over orgSecrets on key collision (D-34). */
  runOverrides: Record<string, string>;
  /** Decrypted org-level secrets fetched at dispatch time. */
  orgSecrets: Record<string, string>;
}

export interface ResolveOutput {
  /**
   * The yamlDefinition with all satisfied placeholders substituted.
   * Unknown placeholders remain as '${VAR}' in the output — the agent merges
   * .xci/secrets.yml for those at execution time (SEC-06).
   */
  resolvedYaml: string;
  /**
   * Names of ${VAR} placeholders present in the YAML that were NOT satisfied by
   * runOverrides or orgSecrets. The agent will attempt to resolve these from
   * .xci/secrets.yml; if still unresolved, the command fails at runtime.
   */
  unresolved: readonly string[];
}

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

export function resolveTaskParams(input: ResolveInput): ResolveOutput {
  // D-34: runOverrides wins over orgSecrets on key collision.
  // Spread order: orgSecrets first, then runOverrides overrides any duplicates.
  const merged: Record<string, string> = { ...input.orgSecrets, ...input.runOverrides };

  const unresolvedSet = new Set<string>();

  // Replace each ${VAR} occurrence:
  // - if key is in merged → substitute the value
  // - otherwise → leave as '${VAR}' and record in unresolved
  const resolvedYaml = input.task.yamlDefinition.replace(PLACEHOLDER_RE, (match, key: string) => {
    const name = key.trim();
    if (Object.hasOwn(merged, name)) {
      // biome-ignore lint/style/noNonNullAssertion: hasOwn guard above confirms key exists
      return merged[name]!;
    }
    unresolvedSet.add(name);
    return match;
  });

  return { resolvedYaml, unresolved: [...unresolvedSet] };
}
