# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-10
**Phase:** 01-foundation
**Areas discussed:** Error hierarchy shape, Source layout & module boundaries, CI matrix details, Skeleton runtime behavior

---

## Error hierarchy shape

### Q1: How should LociError subclasses be organized?

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: area base + failure subclasses | ConfigError, CommandError, InterpolationError, ExecutorError, CliError as base classes; each area defines concrete failure subclasses. Stable exit-code groups AND precise catch targets. | ✓ |
| Per-failure only (flat) | One subclass per concrete failure, all extending LociError directly. No way to catch "any config problem" as a group. | |
| Per-area only | Just 5-6 category classes. Failure details in message/code fields. Callers cannot pattern-match on specific failures. | |

**User's choice:** Hybrid: area base + failure subclasses (recommended)
**Notes:** Preserves both granular catch targets and category-level handling.

### Q2: How should exit codes map to errors?

| Option | Description | Selected |
|--------|-------------|----------|
| Per category, stable ranges (10/20/30/40/50) | Fixed exit code per area; child-process codes still propagate for EXE. | ✓ |
| Per concrete failure | Every subclass gets its own exit code. More granular but many codes to maintain. | |
| Binary: 0 success / 1 any loci error | Simple but loses CLI-09's "exit code dedicati per categoria". | |

**User's choice:** Per category, stable ranges
**Notes:** 10=Config, 20=Commands, 30=Interpolation, 40=Executor, 50=CLI.

### Q3: How much of the hierarchy does Phase 1 actually define?

| Option | Description | Selected |
|--------|-------------|----------|
| Full taxonomy, declared but not thrown | All subclasses defined in errors.ts in Phase 1; Phases 2-5 just import & throw. | ✓ |
| Base + area classes only | LociError + area classes in P1; concrete subclasses added by each later phase. | |
| LociError base class only | Just the root class with structured shape; subclasses in later phases. | |

**User's choice:** Full taxonomy, declared but not thrown
**Notes:** Accepts bigger P1 diff to minimize churn on later phases.

### Q4: What structured fields should LociError carry beyond message/name?

| Option | Description | Selected |
|--------|-------------|----------|
| code + category + suggestion? + cause? | Machine-readable code, category label, optional human hint, Node 16+ cause. Matches CLI-09. | ✓ |
| code + category only | Suggestions live in message string. | |
| Just message + name | Traditional JS Error. CLI-09 harder later. | |

**User's choice:** code + category + suggestion? + cause? (recommended)

---

## Source layout & module boundaries

### Q1: How should src/ be structured?

| Option | Description | Selected |
|--------|-------------|----------|
| Feature folders aligned to pipeline | src/config/, src/commands/, src/resolver/, src/executor/, src/cli/, src/errors.ts, src/types.ts. Matches ARCHITECTURE.md. | ✓ |
| Flat src/ | All files at src/ root. | |
| Layered (domain/infra/cli) | More abstract, overkill for ~2k LoC CLI. | |

**User's choice:** Feature folders aligned to pipeline (recommended)

### Q2: Does Phase 1 pre-create stub files for Phases 2-5?

| Option | Description | Selected |
|--------|-------------|----------|
| Create empty folders + index.ts stubs | Each feature folder has an index.ts that throws 'Not implemented'; types.ts fully populated. | ✓ |
| Only files Phase 1 actually needs | Later phases create their own folders. | |
| Interfaces in types.ts, no subfolders | Hybrid — subfolders appear lazily. | |

**User's choice:** Create empty folders + index.ts stubs (recommended)

### Q3: Where does the bin entry point live?

| Option | Description | Selected |
|--------|-------------|----------|
| src/cli.ts → dist/cli.mjs | Single file with tsup shebang injection. Matches STACK.md. | ✓ |
| src/bin/loci.ts → dist/bin/loci.mjs | Conventional bin/ folder. | |
| src/index.ts doubling as bin | Conflates library entry (we have none) with CLI entry. | |

**User's choice:** src/cli.ts → dist/cli.mjs (recommended)

### Q4: Where do tests live?

| Option | Description | Selected |
|--------|-------------|----------|
| Co-located __tests__ per module | src/config/__tests__/loader.test.ts next to loader.ts. | ✓ |
| Top-level tests/ mirroring src/ | Cleaner bundle but path sync. | |
| Inline *.test.ts beside source | Minimal nesting; tsup needs explicit entry glob. | |

**User's choice:** Co-located __tests__ per module (recommended)

---

## CI matrix details

### Q1: Which Node.js versions should CI test against?

| Option | Description | Selected |
|--------|-------------|----------|
| 20 + 22 | Node 20 engines floor + Node 22 Active LTS. 2×3 = 6 jobs. | ✓ |
| 20 only | Just the floor. Fastest but misses v22+ regressions. | |
| 20 + 22 + 24 | Adds Node 24. 3×3 = 9 jobs; adoption still thin. | |

**User's choice:** 20 + 22 (recommended)

### Q2: Which OS runners should the matrix use?

| Option | Description | Selected |
|--------|-------------|----------|
| ubuntu-latest + windows-latest + macos-latest | Real Windows mandatory per PITFALLS.md; Apple silicon macOS. | ✓ |
| ubuntu + windows only | Violates FND-02. | |
| + macos-13 (Intel) | execa/tsup are arch-agnostic; unnecessary. | |

**User's choice:** ubuntu-latest + windows-latest + macos-latest (recommended)

### Q3: Cold-start performance gate in CI?

| Option | Description | Selected |
|--------|-------------|----------|
| Smoke check only in P1, hyperfine gate in Phase 5 | `loci --version` exits 0; real gate deferred until there is code worth measuring. | ✓ |
| hyperfine --runs 10 strict gate, fail > 300ms | Risk of runner-noise flake on shared GitHub runners. | |
| hyperfine warn-only | Visibility without failure, but setup cost & nobody reads logs. | |

**User's choice:** Smoke check only in P1 (after explanation of runner-noise risk)
**Notes:** User initially asked "spiega meglio" — extended prose explanation provided before re-asking. User accepted the recommendation. Deferred idea recorded for Phase 5.

### Q4: When should CI run?

| Option | Description | Selected |
|--------|-------------|----------|
| Push to main + all PRs + workflow_dispatch | Standard workflow. | ✓ |
| PRs only | Saves runners but loses direct-push safety. | |
| Any push + PRs | More cost; rarely worth it on solo project. | |

**User's choice:** Push to main + all PRs (recommended)

---

## Skeleton runtime behavior

### Q1: How wired should the Phase 1 `loci` binary be at runtime?

| Option | Description | Selected |
|--------|-------------|----------|
| Commander.js wired, no aliases yet | Program with --version/--help/default action and phase-1 hint. Phases 2-5 extend the same program. | ✓ |
| Hand-rolled minimal shim | Parse argv manually; wastes work since P5 rewrites. | |
| Commander + placeholder sub-command | Tests dynamic registration early but sets bad precedent. | |

**User's choice:** Commander.js wired, no aliases yet (recommended)

### Q2: Where does `--version` read its value from?

| Option | Description | Selected |
|--------|-------------|----------|
| Inlined at build time by tsup | `define` replaces `__LOCI_VERSION__` with package.json version. Zero fs reads. | ✓ |
| Read package.json at runtime | Adds fs call; brittle to bundling. | |
| Hardcoded constant | Drifts from package.json; rejected. | |

**User's choice:** Inlined at build time by tsup (recommended)

### Q3: What does `loci` with zero arguments print in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Commander's default help + 'no commands defined' hint | Graceful degradation matching CLI-02. | ✓ |
| Silent exit 0 | Confusing — looks broken. | |
| Error 'no commands defined', exit 1 | Empty state is valid in P1, not an error. | |

**User's choice:** Commander's default help + hint (recommended)

### Q4: What smoke tests does Phase 1 ship?

| Option | Description | Selected |
|--------|-------------|----------|
| Unit + E2E binary smoke | Unit tests for errors.ts; spawn tests for dist/cli.mjs across all 3 OS. | ✓ |
| Unit tests only | No proof dist/cli.mjs is actually runnable. | |
| E2E binary smoke only | Skips coverage of error hierarchy. | |

**User's choice:** Unit + E2E binary smoke (recommended)

---

## Claude's Discretion

Areas where the user deferred to the planner/executor:
- Exact `code` string format for concrete error classes
- biome config preset strictness
- vitest pool/isolate/reporter options
- Whether types.ts stays one file or becomes a `src/types/` barrel
- Exact tsup options (subject to constraints: single .mjs, shebang, bundled deps)
- License choice (MIT suggested, lands in Phase 5)
- npm vs npm-ci for CI install
- Repository hygiene files (.gitignore, .editorconfig, .nvmrc)
- package.json metadata (author, repository, bugs, homepage)
- Whether the empty-state hint uses `addHelpText('after')` or default action callback

## Deferred Ideas

- **Phase 5 (Polish):** Add `hyperfine --runs 10 'loci --version'` cold-start gate with <300ms threshold on all 3 OS in CI, once there is meaningful code to measure.
- **Phase 5:** LICENSE file (MIT) and full repository metadata population.
- **Pre-Phase 5 blocker (already in STATE.md):** verify `npm info loci` name availability before first publish.
