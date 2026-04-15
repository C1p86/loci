---
phase: quick
plan: 260415-jxl
type: execute
wave: 1
depends_on: []
files_modified:
  - src/cli.ts
  - src/__tests__/cli.e2e.test.ts
autonomous: true
requirements:
  - CLI-KV-01
must_haves:
  truths:
    - "xci deploy registry=http://localhost resolves ${registry} in the command before execution"
    - "CLI KEY=VALUE args are injected as env vars (REGISTRY=http://localhost) into child processes"
    - "KEY=VALUE overrides take precedence over all config layers (machine, project, secrets, local)"
    - "Args after -- are treated as pass-through (not parsed as overrides)"
    - "Secrets redaction does NOT apply to CLI overrides (they are already visible in terminal)"
  artifacts:
    - path: "src/cli.ts"
      provides: "parseCliOverrides() helper + wired into sub.action"
    - path: "src/__tests__/cli.e2e.test.ts"
      provides: "E2E tests for KEY=VALUE override behavior"
  key_links:
    - from: "src/cli.ts sub.action"
      to: "resolver.resolve()"
      via: "patched ResolvedConfig with CLI overrides merged into values"
    - from: "src/cli.ts sub.action"
      to: "buildEnvVars()"
      via: "patched config.values includes CLI overrides → env vars set for child"
---

<objective>
Add CLI KEY=VALUE parameter overrides as the highest-precedence config layer.

Purpose: Allow `xci deploy registry=http://localhost app_name=test` to inject ephemeral
per-invocation values into the resolved config and child process env vars, without
modifying any config file on disk. This closes the last gap in the 4-layer precedence
chain: machine → project → secrets → local → CLI overrides.

Output: `src/cli.ts` gains a `parseCliOverrides()` helper and the alias action wires
overrides into both interpolation (via patched config values) and env var injection.
New E2E tests verify parsing, precedence, env injection, and `--` pass-through boundary.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@src/cli.ts
@src/types.ts
@src/resolver/interpolate.ts
@src/resolver/envvars.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add parseCliOverrides helper and wire into alias action</name>
  <files>src/cli.ts</files>
  <behavior>
    - parseCliOverrides(['registry=http://localhost', 'app_name=test', '--', '--foo'])
      → { overrides: { registry: 'http://localhost', app_name: 'test' }, passThrough: ['--foo'] }
    - parseCliOverrides(['--foo', 'bar', '--', 'baz=x'])
      → { overrides: {}, passThrough: ['--foo', 'bar', '--', 'baz=x'] }
      (args before '--' that do NOT match KEY=VALUE become pass-through; args after '--' are never parsed as overrides)
    - parseCliOverrides([]) → { overrides: {}, passThrough: [] }
    - KEY=VALUE match: first '=' splits key from value; key must be non-empty; value can be empty string or contain '='
      Pattern: /^([^=]+)=(.*)$/ where key must be non-empty
    - Args before '--' that do NOT match KEY=VALUE (e.g. '--foo', 'bar') → pass-through (not overrides)
  </behavior>
  <action>
Add a pure `parseCliOverrides` function to `src/cli.ts` (exported for testability) above `registerAliases`:

```typescript
/**
 * Partition raw CLI args into KEY=VALUE overrides and pass-through args.
 *
 * Rules:
 * - Split at the first '--' separator (if present). Everything after '--' is pass-through verbatim.
 * - Before '--': args matching /^([^=]+)=(.*)$/ (non-empty key) are overrides.
 * - Before '--': args NOT matching that pattern are pass-through.
 * - Overrides have highest config precedence (above local.yml). No redaction applies.
 */
export function parseCliOverrides(args: readonly string[]): {
  overrides: Record<string, string>;
  passThrough: string[];
} {
  const dashDashIdx = args.indexOf('--');
  const preArgs = dashDashIdx === -1 ? [...args] : args.slice(0, dashDashIdx);
  const postArgs = dashDashIdx === -1 ? [] : args.slice(dashDashIdx + 1);

  const overrides: Record<string, string> = {};
  const passThrough: string[] = [...postArgs];

  for (const arg of preArgs) {
    const match = /^([^=]+)=(.*)$/.exec(arg);
    if (match && match[1]) {
      overrides[match[1]] = match[2] ?? '';
    } else {
      passThrough.unshift(arg); // preserve order for non-override pre-args
    }
  }
  // Restore order: non-override pre-args come before post-args
  // Rebuild: collect pre pass-through in order, then post-args
  const prePassThrough: string[] = [];
  for (const arg of preArgs) {
    const match = /^([^=]+)=(.*)$/.exec(arg);
    if (!(match && match[1])) {
      prePassThrough.push(arg);
    }
  }

  return { overrides, passThrough: [...prePassThrough, ...postArgs] };
}
```

NOTE: The two-pass implementation above has a bug (passThrough built twice). Use the clean single-pass version below instead:

```typescript
export function parseCliOverrides(args: readonly string[]): {
  overrides: Record<string, string>;
  passThrough: string[];
} {
  const dashDashIdx = args.indexOf('--');
  const preArgs = dashDashIdx === -1 ? args : args.slice(0, dashDashIdx);
  const postArgs = dashDashIdx === -1 ? [] : [...args.slice(dashDashIdx + 1)];

  const overrides: Record<string, string> = {};
  const prePassThrough: string[] = [];

  for (const arg of preArgs) {
    const match = /^([^=]+)=(.*)$/.exec(arg);
    if (match?.[1] !== undefined) {
      overrides[match[1]] = match[2] ?? '';
    } else {
      prePassThrough.push(arg);
    }
  }

  return { overrides, passThrough: [...prePassThrough, ...postArgs] };
}
```

Wire into `sub.action` in `registerAliases`. Replace the current `extraArgs` / `finalPlan` logic:

BEFORE:
```typescript
sub.action(async function (this: Command, options: { dryRun?: boolean; verbose?: boolean }) {
  const extraArgs: string[] = this.args;

  // Resolve the execution plan
  const plan = resolver.resolve(alias, commands, config);

  // Build env vars for child processes
  const env = buildEnvVars(config.values);
  ...
  // Append extra args (pass-through) to the plan's argv
  const finalPlan = extraArgs.length > 0 ? appendExtraArgs(plan, extraArgs) : plan;
  ...
```

AFTER:
```typescript
sub.action(async function (this: Command, options: { dryRun?: boolean; verbose?: boolean }) {
  const { overrides, passThrough } = parseCliOverrides(this.args);

  // Merge CLI overrides into config values (highest precedence — above local.yml)
  const effectiveValues = Object.keys(overrides).length > 0
    ? { ...config.values, ...overrides }
    : config.values;
  const effectiveConfig: ResolvedConfig = Object.keys(overrides).length > 0
    ? { ...config, values: effectiveValues }
    : config;

  // Resolve the execution plan using effective (override-patched) config
  const plan = resolver.resolve(alias, commands, effectiveConfig);

  // Build env vars: base from effectiveValues (includes CLI overrides); no redaction for overrides
  const env = buildEnvVars(effectiveValues);
  ...
  // Append pass-through args to the plan's argv
  const finalPlan = passThrough.length > 0 ? appendExtraArgs(plan, passThrough) : plan;
  ...
```

The `secretValues` for dry-run redaction continues to come from `config` (not `effectiveConfig`).
Overrides are NOT in `secretKeys` so they print unredacted in --dry-run and --verbose — this is correct
per spec ("secrets redaction does NOT apply to CLI overrides").
  </action>
  <verify>
    <automated>cd /home/developer/projects/jervis && npm run build 2>&1 | tail -5 && npx vitest run --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>
    parseCliOverrides is exported from cli.ts; alias action uses it; build succeeds; existing tests pass.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add E2E tests for KEY=VALUE override behavior</name>
  <files>src/__tests__/cli.e2e.test.ts</files>
  <action>
Add a new describe block at the end of the existing E2E test file (before the closing of the outer describe):

```typescript
// ------------------------------------------------------------------
// CLI-KV: KEY=VALUE positional parameter overrides
// ------------------------------------------------------------------

describe('CLI-KV: KEY=VALUE positional parameter overrides', () => {
  it('CLI-KV-01: KEY=VALUE overrides resolve ${VAR} placeholder in command', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'deploy:\n  cmd: ["node", "-e", "process.stdout.write(process.env.REGISTRY)"]\n',
        '.loci/config.yml': 'registry: default-registry\n',
        'print-args.mjs': "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n",
      }),
    );
    // Override registry via CLI — child receives REGISTRY env var with the override value
    const { stdout, code } = runCliInDir(dir, ['deploy', 'registry=http://localhost:5000']);
    expect(code).toBe(0);
    expect(stdout).toContain('http://localhost:5000');
  });

  it('CLI-KV-02: KEY=VALUE overrides interpolated in cmd template', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml':
          'greet:\n  cmd: ["node", "-e", "process.stdout.write(\'${greeting}\'.replace(/\\$\\{greeting\\}/, process.env.GREETING))"]\n',
        '.loci/config.yml': 'greeting: hello\n',
      }),
    );
    // Better: use a script that reads env var directly
    const dir2 = trackDir(
      createTempProject({
        '.loci/commands.yml': 'greet:\n  cmd: ["node", "-e", "process.stdout.write(process.env.GREETING)"]\n',
        '.loci/config.yml': 'greeting: hello\n',
      }),
    );
    const { stdout, code } = runCliInDir(dir2, ['greet', 'greeting=world']);
    expect(code).toBe(0);
    expect(stdout).toContain('world');
  });

  it('CLI-KV-03: multiple KEY=VALUE args all override independently', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'info:\n  cmd: ["node", "-e", "process.stdout.write(process.env.A + \':\' + process.env.B)"]\n',
        '.loci/config.yml': 'a: original-a\nb: original-b\n',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['info', 'a=new-a', 'b=new-b']);
    expect(code).toBe(0);
    expect(stdout).toContain('new-a:new-b');
  });

  it('CLI-KV-04: CLI overrides have higher precedence than local.yml', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'show:\n  cmd: ["node", "-e", "process.stdout.write(process.env.MYVAR)"]\n',
        '.loci/config.yml': 'myvar: from-config\n',
        '.loci/local.yml': 'myvar: from-local\n',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['show', 'myvar=from-cli']);
    expect(code).toBe(0);
    expect(stdout).toContain('from-cli');
  });

  it('CLI-KV-05: args after -- are pass-through, not treated as overrides', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'showargs:\n  cmd: ["node", "print-args.mjs"]\n',
        '.loci/config.yml': '',
        'print-args.mjs': "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n",
      }),
    );
    // baz=x after -- must appear as literal arg, not become env var override
    const { stdout, code } = runCliInDir(dir, ['showargs', '--', 'baz=x']);
    expect(code).toBe(0);
    const args = JSON.parse(stdout.trim()) as string[];
    expect(args).toContain('baz=x');
  });

  it('CLI-KV-06: non-KEY=VALUE args before -- are treated as pass-through, not overrides', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'showargs:\n  cmd: ["node", "print-args.mjs"]\n',
        '.loci/config.yml': '',
        'print-args.mjs': "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n",
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['showargs', 'not-an-override']);
    expect(code).toBe(0);
    const args = JSON.parse(stdout.trim()) as string[];
    expect(args).toContain('not-an-override');
  });

  it('CLI-KV-07: --dry-run shows CLI override values unredacted', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'deploy:\n  cmd: ["echo", "${registry}"]\n',
        '.loci/config.yml': 'registry: default\n',
      }),
    );
    const { stderr, code } = runCliInDir(dir, ['deploy', 'registry=http://localhost', '--dry-run']);
    expect(code).toBe(0);
    expect(stderr).toContain('http://localhost');
  });
});
```

Notes on test design:
- CLI-KV-01 and CLI-KV-02 can be simplified to a single clean pattern — verify env var injection
- CLI-KV-04 requires creating a `.loci/local.yml` inside the temp project, which `createTempProject` supports
- CLI-KV-05 verifies the `--` boundary (pass-through args that look like `KEY=VALUE` are NOT parsed as overrides)
- CLI-KV-06 verifies non-`KEY=VALUE` pre-`--` args flow as pass-through to the child
- CLI-KV-07 verifies no redaction for CLI overrides (they should appear verbatim in --dry-run output)

The test for CLI-KV-02 has an unused `dir` — remove it, only use `dir2`. Or consolidate into one temp project. Ensure no lint errors from biome.
  </action>
  <verify>
    <automated>cd /home/developer/projects/jervis && npm run build && npx vitest run src/__tests__/cli.e2e.test.ts --reporter=verbose 2>&1 | tail -40</automated>
  </verify>
  <done>
    All CLI-KV-01 through CLI-KV-07 tests pass. Build succeeds with no TypeScript errors.
    No biome lint errors (`npx biome check src/` passes or only has pre-existing warnings).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| terminal → cli.ts | KEY=VALUE args come from the user's own terminal session |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-KV-01 | Information Disclosure | parseCliOverrides / --verbose trace | accept | CLI overrides are intentionally visible — user typed them. No log suppression needed. |
| T-KV-02 | Tampering | effectiveConfig | accept | CLI overrides only affect the current process invocation; no config file is written. Scope is zero. |
| T-KV-03 | Spoofing | env var injection | accept | Child process receives env vars; child is launched by the same user who typed the command. No privilege boundary crossed. |
</threat_model>

<verification>
1. `npm run build` completes without TypeScript errors
2. `npx vitest run` — all existing tests pass, all new CLI-KV tests pass
3. Manual smoke: create a temp project with `registry` in config.yml, run `xci deploy registry=http://localhost:5000`, confirm child receives `REGISTRY=http://localhost:5000` env var
4. `npx biome check src/` — no new lint errors introduced
</verification>

<success_criteria>
- `parseCliOverrides` exported from `cli.ts`, handles KEY=VALUE detection, `--` boundary, and non-override pass-through
- Alias action uses patched `effectiveConfig` for resolver and env var building
- 7 new E2E tests all pass covering override resolution, precedence, env injection, `--` boundary, and dry-run display
- No regression in existing 20+ CLI E2E tests
</success_criteria>

<output>
After completion, create `.planning/quick/260415-jxl-add-cli-key-value-parameter-overrides/260415-jxl-SUMMARY.md`
</output>
