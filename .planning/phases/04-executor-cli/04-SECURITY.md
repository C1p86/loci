---
phase: 04-executor-cli
asvs_level: 1
block_on: critical
audited_date: 2026-04-14
threats_total: 11
threats_closed: 11
threats_open: 0
---

# Phase 04 — Executor CLI: Security Audit

## Result: SECURED

**Threats Closed:** 11/11
**ASVS Level:** 1
**Block-on policy:** critical

---

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-04-01 | Tampering | mitigate | CLOSED | `src/executor/single.ts:29` — `reject: false` passed to execa; execa default is `shell: false` (argv array, no shell expansion). Comment at line 3 documents shell:false invariant. |
| T-04-02 | Information Disclosure | mitigate | CLOSED | `src/executor/output.ts:120-121` — `redactArgv()` replaces argv tokens matching secret values with `***`. `printDryRun` (line 132) applies this to all plan kinds (single:140, sequential:149, parallel:160). Caller in cli.ts:156 passes `buildSecretValues(config)` result (actual values, not keys). |
| T-04-03 | Information Disclosure | mitigate | CLOSED | `src/executor/output.ts:191` — `printVerboseTrace` calls `redactSecrets(envVars, secretKeys)` from `src/resolver/envvars.js` before writing env vars. cli.ts:150-151 passes already-redacted env (`redactedEnv`) to the function. |
| T-04-04 | Denial of Service | mitigate | CLOSED | `src/executor/parallel.ts:54` — `forceKillAfterDelay: 3000` present in execa options for every parallel child. |
| T-04-05 | Denial of Service | mitigate | CLOSED | `src/executor/parallel.ts:36` — `process.on('SIGINT', sigintHandler)` registers handler. Line 74 — `process.off('SIGINT', sigintHandler)` cleans up after `Promise.allSettled` completes (both fast and complete paths). |
| T-04-06 | Spoofing | accept | CLOSED | Accepted risk — see Accepted Risks log below. |
| T-04-07 | Information Disclosure | mitigate | CLOSED | `src/cli.ts:150` — `redactSecrets(env, config.secretKeys)` called before passing env to `printVerboseTrace`. Verbose path emits only redacted values. |
| T-04-08 | Information Disclosure | mitigate | CLOSED | `src/cli.ts:136,156` — `buildSecretValues(config)` builds the actual-values set; `printDryRun(plan, secretValues)` receives it. `redactArgv` replaces matching tokens with `***`. |
| T-04-09 | Tampering | mitigate | CLOSED | `src/cli.ts:83-105` — `appendExtraArgs` splices pass-through args into the argv array. Execution flows to `execa` in `single.ts` with no shell option, so args are never shell-interpreted regardless of content. |
| T-04-10 | Elevation of Privilege | accept | CLOSED | Accepted risk — see Accepted Risks log below. |
| T-04-11 | Spoofing | accept | CLOSED | Accepted risk — see Accepted Risks log below. |

---

## Accepted Risks Log

| Threat ID | Category | Component | Rationale | Owner |
|-----------|----------|-----------|-----------|-------|
| T-04-06 | Spoofing | executor/output.ts | Child process output could contain ANSI codes that mimic the parallel prefix format. Accepted: loci applies the prefix server-side in the generator transform, and a malicious child would require knowledge of the exact per-alias color hash output. Low risk for a local CLI tool used by the same user who wrote the commands. | Accepted in 04-01-PLAN.md threat model. |
| T-04-10 | Elevation of Privilege | cli.ts walk-up discovery | Walk-up `.loci/` discovery (`findLociRoot`) may pick up a config in a parent directory the user did not intend. Accepted: this is standard convention (git, npm, cargo all do the same); the user controls their filesystem and the config is not privileged data. | Accepted in 04-02-PLAN.md threat model. |
| T-04-11 | Spoofing | cli.ts dynamic command registration | Alias names from `commands.yml` become commander sub-commands. A crafted `commands.yml` could define aliases colliding with built-in option names. Accepted: `commands.yml` is user-authored and version-controlled; commander v14 handles option name conflicts by ignoring sub-command registration conflicts with built-in flags. | Accepted in 04-02-PLAN.md threat model. |

---

## Unregistered Flags

None. Both SUMMARY files (`04-01-SUMMARY.md` and `04-02-SUMMARY.md`) report `## Threat Flags: None` — all mitigations from the plan threat model were confirmed implemented by the executor during the implementation phase.

---

## Implementation Notes

**T-04-01 — shell:false implicit reliance:** execa's `shell` option defaults to `false`; no explicit `shell: false` key appears in the execa options object in `single.ts` or `parallel.ts`. The mitigation is correct by default but is not enforced as an explicit option. This is informational only at ASVS Level 1; it does not constitute an open threat. If hardening to Level 2, consider adding `shell: false` explicitly to both call sites.

**T-04-02 / T-04-08 parameter naming note:** `printDryRun`'s parameter is named `secretKeys: ReadonlySet<string>` (line 132) but the in-code comment (line 133-135) clarifies the caller must pass `buildSecretValues(config)` (actual values). The cli.ts caller (line 156) correctly passes `secretValues` (the actual values set). The parameter name is a documentation inconsistency, not a security gap.
