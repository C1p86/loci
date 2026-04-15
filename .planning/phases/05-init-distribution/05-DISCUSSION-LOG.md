# Phase 5: Init & Distribution - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 05-init-distribution
**Areas discussed:** npm package name, loci init content, README depth, .gitignore strategy

---

## npm Package Name

| Option | Description | Selected |
|--------|-------------|----------|
| `loci` (original) | Already taken on npm (v0.2.0, abandoned tape wrapper) | |
| `loci-cli` | Available, standard suffix convention | |
| `runloci` | Available, action + name | |
| `lokicli` | Available, phonetic "loki" | |
| `loci-run` | Available, name + action | |
| `xci` | Available, 3 letters, "execute CI" | ✓ |

**User's choice:** `xci` — user wanted a 3-character name. After checking ~50 combinations, `xci` was the best fit: short, pronounceable ("ex-ci"), semantically meaningful.
**Notes:** Binary command stays `loci`. Only the npm package name is `xci`. Verified available on npm 2026-04-15.

---

## loci init Example Content

| Option | Description | Selected |
|--------|-------------|----------|
| Hello world only | Single minimal alias | ✓ |
| Multi-example | 2-3 aliases (single, sequential, parallel) | |

**User's choice:** Solo un hello world.
**Notes:** INIT-04 in requirements says "2-3 alias dimostrativi" but user prefers minimal. README will cover the other patterns.

---

## README Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Quickstart only | Install + init + run | |
| Complete reference | Quickstart + full config/commands docs | ✓ |

**User's choice:** README completo.
**Notes:** Covers quickstart, 4 config levels, commands.yml format, platform overrides, shell:false explanation.

---

## .gitignore Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Only loci entries | Create .gitignore with just the 2 loci lines if missing | ✓ |
| Base template | Generate a generic .gitignore with common entries | |

**User's choice:** Solo le 2 righe loci — il tool non sa che tipo di progetto e.
**Notes:** Append with `# loci` comment header. Skip duplicates. Don't generate opinionated templates.

---

## Claude's Discretion

- README section ordering and structure
- Exact wording of example config comments
- Badge inclusion in README

## Deferred Ideas

None
