# Phase 3: Commands & Resolver - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 03-commands-resolver
**Areas discussed:** YAML schema design, Placeholder resolution, Composition & cycles, Platform overrides

---

## YAML Schema Design

| Option | Description | Selected |
|--------|-------------|----------|
| String shorthand | Simple string value, explicit object form also accepted | ✓ |
| Always object form | Every command is an object, even simple ones | |
| Array form | Pre-split argv array | |

**User's choice:** String shorthand
**Notes:** Both string shorthand and explicit object form accepted. Object form needed for description and platform overrides.

---

| Option | Description | Selected |
|--------|-------------|----------|
| steps: / parallel: keys | Explicit key name declares execution mode | ✓ |
| Bare YAML list = sequence | Bare list under alias is a sequence | |

**User's choice:** steps: / parallel: keys
**Notes:** Unambiguous — key name explicitly declares sequential vs concurrent.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Whitespace split | Split on whitespace with quoted segment support | ✓ |
| Shell-style parsing | Full shell tokenization with backslash escapes | |

**User's choice:** Whitespace split
**Notes:** Array form available for edge cases.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, all types | Any alias can have a description field | ✓ |
| You decide | Claude picks | |

**User's choice:** Yes, all types

---

## Placeholder Resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Inline expansion | Placeholders expand in-place within the token | ✓ |
| One placeholder per token | Each token can contain at most one ${VAR} | |

**User's choice:** Inline expansion
**Notes:** Natural for patterns like user@host, URLs with embedded vars.

---

| Option | Description | Selected |
|--------|-------------|----------|
| $${} escape | Double dollar sign produces literal ${} | ✓ |
| No escaping | Only known keys replaced, undefined = error | |
| Backslash escape | \${} for literal — problematic on Windows | |

**User's choice:** $${} escape
**Notes:** Familiar from Makefiles.

---

| Option | Description | Selected |
|--------|-------------|----------|
| All keys injected | Every config key becomes an env var | ✓ |
| Only referenced keys | Only ${VAR} placeholders become env vars | |

**User's choice:** All keys injected
**Notes:** 12-factor model — secrets in env vars are normal. Redaction applies only to loci's own output.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Dots to underscores, uppercased | deploy.host → DEPLOY_HOST | ✓ |
| Keep dots as-is | deploy.host → deploy.host in env | |
| LOCI_ prefix + underscore | deploy.host → LOCI_DEPLOY_HOST | |

**User's choice:** Dots to underscores, uppercased
**Notes:** Standard env var convention.

---

## Composition & Cycles

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, mixed | Each step can be inline command or alias reference | ✓ |
| Only alias references | Steps must be alias names | |
| Only inline commands | No alias refs in steps | |

**User's choice:** Yes, mixed
**Notes:** Maximum flexibility for users.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Lookup-based | If string matches known alias, expand; otherwise inline | ✓ |
| Explicit ref: prefix | Alias refs use ref:name or @name prefix | |

**User's choice:** Lookup-based
**Notes:** Edge case: alias named "npm" shadows system binary — user uses quoted string or array form to force inline.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Reasonable limit (~10) | Cap nesting at 10 levels | ✓ |
| No limit | Only cycle detection constrains depth | |
| You decide | Claude picks | |

**User's choice:** Reasonable limit (~10)

---

| Option | Description | Selected |
|--------|-------------|----------|
| At load time, eagerly | Validate ALL aliases before any command runs | ✓ |
| Lazy, on resolve | Only validate the alias being run | |

**User's choice:** At load time, eagerly
**Notes:** Catches broken aliases early, even if not invoked.

---

## Platform Overrides

| Option | Description | Selected |
|--------|-------------|----------|
| Replace entire command | Platform block provides complete alternative command | ✓ |
| Override just the executable | Platform replaces only the binary name | |

**User's choice:** Replace entire command
**Notes:** Simple mental model.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Single commands only | Platform overrides on single type commands only | ✓ |
| All command types | Any alias type can have platform overrides | |

**User's choice:** Single commands only
**Notes:** Sequences/parallel achieve per-platform behavior via composed aliases.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Require default cmd: | Every command must have a cmd: fallback | |
| Error at run time | Platform-only aliases allowed, error if no match on current OS | ✓ |
| Skip silently | No-op if no matching platform | |

**User's choice:** Error at run time
**Notes:** Confirmed in follow-up — enables legitimate platform-specific-only aliases for multi-platform teams.

---

## Claude's Discretion

- Internal architecture of commands loader and resolver
- Exact whitespace-split implementation
- Cycle detection algorithm choice
- Test organization
- How ExecutionPlan represents env vars

## Deferred Ideas

None — discussion stayed within phase scope.
