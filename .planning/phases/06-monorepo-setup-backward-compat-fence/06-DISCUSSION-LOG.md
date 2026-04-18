# Phase 6: Monorepo Setup & Backward-Compat Fence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 06-monorepo-setup-backward-compat-fence
**Areas discussed:** Skeleton scope, Fence CI mechanisms, Changesets & versioning, CI matrix & Turbo pipeline

---

## Skeleton scope dei package

### What to create in packages/

| Option | Description | Selected |
|--------|-------------|----------|
| Solo xci (spostato) | Only move existing code to `packages/xci/`. Phase 7 creates server later. | |
| xci + placeholder vuoti | `packages/xci/` + empty `packages/server/` and `packages/web/` with minimal package.json | ✓ |
| xci + scaffolding funzionale | All 3 fully scaffolded with tsconfig + build stubs | |

### Root layout

| Option | Description | Selected |
|--------|-------------|----------|
| Root minimale | Root: package.json (workspaces), pnpm-workspace.yaml, turbo.json, shared biome.json, .changeset/, tsconfig.base.json | ✓ |
| Root sostanziosa | Root also holds shared vitest config and aggregated scripts | |

### README location

| Option | Description | Selected |
|--------|-------------|----------|
| Split: root + per-package | Root = monorepo overview; packages/xci/README.md = v1 README for npm | ✓ |
| Resta tutto in root | Single README symlinked or via `readme` field | |

### Dist path

| Option | Description | Selected |
|--------|-------------|----------|
| `packages/xci/dist/cli.mjs` | Package-relative path; bin points here; CI gate checks this | ✓ |
| Root `dist/` | Centralized build output | |

---

## Meccanismi di 'fence' CI

### Bundle-size gate tool

| Option | Description | Selected |
|--------|-------------|----------|
| size-limit | Industry standard, PR comments with delta, declarative config | ✓ |
| Script bash custom | `stat -c %s` check in CI, zero deps | |
| bundlewatch | Similar to size-limit but less maintained | |

### ws / reconnecting-websocket exclusion

| Option | Description | Selected |
|--------|-------------|----------|
| Tutti e 3 belt-and-suspenders | tsup external + CI grep + Biome noRestrictedImports | ✓ |
| Solo tsup external + grep | Build-time + test-time, no lint | |
| Solo tsup external | Minimal — trust tsup alone | |

### Cold-start gate

| Option | Description | Selected |
|--------|-------------|----------|
| Sì, su Linux runner | hyperfine --runs 10 on ubuntu-latest, fail if mean > 300ms | ✓ |
| No, solo smoke check | Only `--version` exit 0; 300ms is a manual release check | |
| Sì, soglia permissiva | hyperfine with 500ms threshold | |

### Required check policy

| Option | Description | Selected |
|--------|-------------|----------|
| Sempre | All gates blocking on any PR to main | ✓ |
| Solo su PR che toccano packages/xci/ | Path-filtered required checks | |

---

## Changesets & versioning

### Versioning strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed (stessa versione) | `fixed: [['xci', '@xci/server', '@xci/web']]` — always same version | ✓ |
| Independent (bump separato) | Each package bumps on its own | |
| Linked (bump coordinato su minor/major) | Middle ground | |

### Private flag

| Option | Description | Selected |
|--------|-------------|----------|
| Root privata, 3 package pubblicati | Root has `"private": true`; xci + server + web publishable | ✓ |
| Solo xci pubblicato in Phase 6 | server + web stay private until Phase 14 | |

### Publish flow

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Action `changesets/action` | Automated Version PR + publish on merge | ✓ |
| Manuale locale | `pnpm changeset version && pnpm publish -r` from owner's machine | |

### @xci scope on npm

| Option | Description | Selected |
|--------|-------------|----------|
| Sì, è già mio | Scope verified mine | |
| No, da verificare | Add verification task in Phase 6, fallback if taken | ✓ |
| Non so / da verificare io | Planner handles as assumption + verification | |

---

## CI matrix & Turbo pipeline

### Turbo pipeline scope

| Option | Description | Selected |
|--------|-------------|----------|
| Minimale: build + test + lint + typecheck | 4 tasks with dep graph, local cache only | ✓ |
| Full: + dev + clean + format | Complete pipeline including unused-in-Phase-6 tasks | |

### CI matrix strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Mantieni matrix attuale su xci | xci: 3 OS × Node [20, 22] = 6 jobs; server/web Linux-only when they have code | ✓ |
| Filter-based con turbo | Single job running `turbo run test --filter=...[HEAD^1]` | |
| Hybrid: matrix xci + filter per altri | xci full matrix, others turbo-filtered | |

### Package manager migration

| Option | Description | Selected |
|--------|-------------|----------|
| Clean cut: delete lockfile, nuovo pnpm-lock.yaml | Single commit; no parallel npm branch | ✓ |
| Parallel: v1-legacy branch with npm | Main goes pnpm, legacy branch keeps npm | |

### pnpm version pinning

| Option | Description | Selected |
|--------|-------------|----------|
| `packageManager` field in root package.json | Corepack-enforced; CI reads from packageManager | ✓ |
| Solo in CI setup action | Hardcoded version in workflow YAML | |

---

## Claude's Discretion

- Exact `size-limit` config format (package.json field vs standalone file)
- Biome `noRestrictedImports` rule syntax and path scoping
- tsconfig.base.json fields (keep Phase 1 values)
- `.changeset/config.json` defaults beyond `fixed`
- Hyperfine install step in CI
- Exact pnpm version pin value (latest stable v9)
- Root monorepo README structure
- Shape of stub index.ts files for server/web

## Deferred Ideas

- Remote Turbo cache
- `dev` / `clean` / `format` Turbo tasks
- Beyond-default size-limit regression reporting
- TypeScript project references
- Separate `biome.json` per package
- v1-legacy branch
- Automated cold-start gate on Windows/macOS
- Marketing-polished monorepo README
