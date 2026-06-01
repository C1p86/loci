# Phase 16: Go CLI Output Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-01
**Phase:** 16-go-cli-output-infrastructure
**Areas discussed:** Header content, Step header upgrade, output.go package location, NO_COLOR / FORCE_COLOR support

---

## Header Content

| Option | Description | Selected |
|--------|-------------|----------|
| Alias + referenced vars only | Print ▶ running: alias in bright cyan, then a variables: block with only vars the alias references via ${VAR}. Secrets masked. Matches GOCLI-06. Steps list deferred to Phase 17. | ✓ |
| Full TypeScript parity: alias + vars + cwd + steps | Full printRunHeader port including steps list and cwd line. Phase 16 would cover Phase 17's scope. | |
| Minimal: alias title only | Just ▶ running: alias, no variables block. |  |

**User's choice:** Alias + referenced vars only (Recommended)
**Notes:** Matches GOCLI-06 spec ("alias name and resolved params"). Steps list and cwd line belong in Phase 17 which explicitly adds cwd/breadcrumb features.

---

## Step Header Upgrade

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — upgrade in Phase 16 | Replace [xci] step N: label with colored ▶ label [N/total] using output.go. Phase 17 only changes the label text for breadcrumbs. | ✓ |
| No — leave plain, upgrade in Phase 17 | Phase 16 only creates output.go and printRunHeader. Step headers stay plain until Phase 17. | |

**User's choice:** Yes — upgrade in Phase 16 (Recommended)
**Notes:** Consistent terminal experience from day 1. Phase 17 breadcrumb work only changes label text, not color infrastructure.

---

## output.go Package Location

| Option | Description | Selected |
|--------|-------------|----------|
| internal/output/ — own package | go-xci/internal/output/output.go as package output. Both cmd/ and executor/ can import it without circular dependencies. | ✓ |
| internal/executor/output.go | Mirrors TypeScript layout (executor/output.ts). executor package grows but cmd/ can import executor. | |

**User's choice:** internal/output/ — own package (Recommended)
**Notes:** Clean separation. No coupling between cmd and executor via output.

---

## NO_COLOR / FORCE_COLOR Support

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — respect both env vars | NO_COLOR=1 disables color (even on TTY), FORCE_COLOR=1 enables (even non-TTY). Matches TypeScript and no-color.org standard. | ✓ |
| TTY detection only | Just check if stderr is a TTY (fatih/color default). Simpler but no operator override mechanism. | |

**User's choice:** Yes — respect both env vars (Recommended)
**Notes:** Matches TypeScript behavior. Important for CI environments.

---

## Step Header Format (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Match TypeScript: ▶ label [N/total] in bold cyan | Same format as TypeScript CLI. Phase 17 only changes label text. | ✓ |
| Keep [xci] prefix, add color only | Keep [xci] step N: label, just colorize. Go CLI stays visually distinct. | |

**User's choice:** Match TypeScript: ▶ label [N/total] in bold cyan (Recommended)
**Notes:** Consistent look across both CLIs. Phase 17 changes label to breadcrumb string, no format change needed.

---

## Claude's Discretion

- Exact color constants and fatih/color API usage
- Step result summary format (✓/✗ icons, duration formatting)
- Whether to expose PrintParallelSummary in Phase 16 or stub it

## Deferred Ideas

None — discussion stayed within phase scope.
