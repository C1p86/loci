---
phase: quick-260422-dfh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/resolver/index.ts
  - packages/xci/src/resolver/__tests__/resolver.test.ts
autonomous: true
must_haves:
  truths:
    - "for_each loop variable is baked into rawArgv so re-interpolation in sequential executor does not throw UndefinedPlaceholderError"
    - "Existing for_each tests continue to pass"
  artifacts:
    - path: "packages/xci/src/resolver/index.ts"
      provides: "Fixed rawArgv in both lenient and strict for_each code paths"
    - path: "packages/xci/src/resolver/__tests__/resolver.test.ts"
      provides: "Test verifying rawArgv has loop variable baked in"
  key_links:
    - from: "packages/xci/src/resolver/index.ts"
      to: "packages/xci/src/executor/sequential.ts"
      via: "rawArgv field on SequentialStep — executor re-interpolates it at line 182"
      pattern: "step\\.rawArgv"
---

<objective>
Fix for_each loop variable not surviving re-interpolation in the sequential executor.

Purpose: When for_each generates sequential steps with inline cmd, the rawArgv still contains
`${LoopVar}` placeholders. The sequential executor re-interpolates rawArgv with env + capturedVars,
but the loop variable is in neither — causing UndefinedPlaceholderError at runtime.

Output: Patched resolver that bakes loop variable into rawArgv, plus regression test.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@packages/xci/src/resolver/index.ts
@packages/xci/src/executor/sequential.ts (lines 179-188 — re-interpolation site)
@packages/xci/src/resolver/__tests__/resolver.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add regression test for rawArgv loop variable baking</name>
  <files>packages/xci/src/resolver/__tests__/resolver.test.ts</files>
  <behavior>
    - Test: for_each sequential steps with inline cmd should have loop variable replaced in rawArgv
    - Given a for_each def with var="svc", in=["api","web"], cmd=["deploy","${svc}","--region","us"]
    - The resolved steps[0].rawArgv should be ["deploy","api","--region","us"] (NOT ["deploy","${svc}","--region","us"])
    - The resolved steps[1].rawArgv should be ["deploy","web","--region","us"]
    - Test: strict-mode (resolveAlias) for_each sequential steps also have loop variable replaced in rawArgv
  </behavior>
  <action>
Add a new describe block in resolver.test.ts: "for_each rawArgv bakes loop variable".

Test 1 — lenient path (resolveToStepsLenient via resolver.resolve returning sequential kind):
Create a CommandDef with kind: 'for_each', var: 'svc', in: ['api', 'web'], cmd: ['deploy', '${svc}', '--region', 'us'].
Resolve via resolver.resolve. Assert plan.kind === 'sequential'. Assert plan.steps has length 2.
Assert steps[0].rawArgv deep-equals ['deploy', 'api', '--region', 'us'].
Assert steps[1].rawArgv deep-equals ['deploy', 'web', '--region', 'us'].

Test 2 — strict path:
Same setup but through the strict resolve path (resolveAlias). The strict path also produces
sequential steps when for_each has no parallel config. Verify rawArgv similarly.

Note: The resolver.resolve function dispatches to resolveAlias (strict). To test the lenient
path, check if resolveToStepsLenient is exercised by the strict path (it is — line 327 calls
resolveToStepsLenient for sub-alias resolution). For inline cmd, the strict path has its own
code at line 329-335. A single test through resolver.resolve will exercise the strict path.
The lenient path is exercised when a for_each uses `run` referencing another alias. To test
both paths directly, also test a for_each with `run` that delegates to another alias with cmd.

Run tests — they MUST fail (rawArgv will still contain ${svc} before the fix).
  </action>
  <verify>
    <automated>cd /home/developer/projects/jervis && npx vitest run packages/xci/src/resolver/__tests__/resolver.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>New test exists and fails with rawArgv containing unresolved ${svc} placeholder</done>
</task>

<task type="auto">
  <name>Task 2: Bake loop variable into rawArgv in both for_each code paths</name>
  <files>packages/xci/src/resolver/index.ts</files>
  <action>
Fix TWO locations in resolver/index.ts:

**Lenient path (around line 142-148):**
Change the `else if (def.cmd)` block inside the for_each case from:
```typescript
rawArgv: def.cmd,
```
to:
```typescript
rawArgv: def.cmd.map(t => t.replaceAll(`\${${def.var}}`, value)),
```

The full block becomes:
```typescript
} else if (def.cmd) {
    const argv = interpolateArgvLenient(def.cmd, loopValues);
    allSteps.push({
        argv,
        rawArgv: def.cmd.map(t => t.replaceAll(`\${${def.var}}`, value)),
        ...(effectiveCwd !== undefined ? { cwd: effectiveCwd } : {}),
    });
}
```

**Strict path (around line 329-335):**
Same fix — change `rawArgv: def.cmd` to `rawArgv: def.cmd.map(t => t.replaceAll(`\${${def.var}}`, value))`.

The full block becomes:
```typescript
} else if (def.cmd) {
    const argv = interpolateArgvLenient(def.cmd, loopValues);
    allSteps.push({
        argv,
        rawArgv: def.cmd.map(t => t.replaceAll(`\${${def.var}}`, value)),
        ...(effectiveCwd !== undefined ? { cwd: effectiveCwd } : {}),
    });
}
```

This ensures the loop variable is resolved in rawArgv before it reaches the sequential executor,
while other placeholders (like captured vars from prior steps) remain as ${placeholder} for
the executor to resolve at runtime.

Do NOT change the `argv` computation — it already uses loopValues via interpolateArgvLenient.
  </action>
  <verify>
    <automated>cd /home/developer/projects/jervis && npx vitest run packages/xci/src/resolver/__tests__/resolver.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>All resolver tests pass, including the new rawArgv baking test. The loop variable is replaced in rawArgv in both lenient and strict for_each code paths.</done>
</task>

</tasks>

<verification>
1. All existing resolver tests pass (no regressions)
2. New rawArgv baking test passes
3. Full xci test suite passes: `cd packages/xci && npx vitest run`
</verification>

<success_criteria>
- for_each sequential steps store rawArgv with loop variable already resolved
- Sequential executor re-interpolation no longer throws UndefinedPlaceholderError for loop variables
- All existing tests continue to pass
</success_criteria>

<output>
After completion, create `.planning/quick/260422-dfh-fix-for-each-loop-variable-not-available/260422-dfh-SUMMARY.md`
</output>
