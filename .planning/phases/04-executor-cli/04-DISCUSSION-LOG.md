# Phase 4: Executor & CLI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 04-executor-cli
**Areas discussed:** Parallel output prefixing, Parallel kill & signal handling, CLI wiring strategy, Dry-run & verbose output format

---

## Parallel Output Prefixing

| Option | Description | Selected |
|--------|-------------|----------|
| Bracket prefix | [alias-name] before each line — concurrently-style | |
| Color-coded bare prefix | Alias name with color, no brackets | ✓ |
| Aligned bracket + color | Brackets with right-aligned alias name, plus color | |

**User's choice:** Color-coded bare prefix
**Notes:** Cleaner visual style for TTY output.

### Interleaving Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Line-buffered | Buffer until newline, then emit | ✓ |
| Unbuffered passthrough | Write bytes as they arrive | |
| Group by command | Buffer all output per command | |

**User's choice:** Line-buffered

### No-TTY Fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Plain prefix, no brackets | Same format without ANSI codes | |
| Fall back to brackets | Switch to [alias] brackets when no TTY | ✓ |
| You decide | Claude picks | |

**User's choice:** Fall back to brackets

### Prefix Alignment

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, right-aligned | Pad shorter names for column alignment | |
| No, left-aligned | No padding, ragged alignment | ✓ |
| You decide | Claude picks | |

**User's choice:** No, left-aligned

### Color Palette

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed rotation | Cycle through 6-8 colors in order | |
| Hash-based | Color from alias name hash, consistent across runs | ✓ |
| You decide | Claude picks | |

**User's choice:** Hash-based

### Stderr Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Same prefix, same stream | Prefix stderr identically, keep streams separate | |
| Same prefix, merged stream | Both to stdout | |
| You decide | Claude picks | ✓ |

**User's choice:** Claude's discretion

### NO_COLOR / FORCE_COLOR

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, respect both | Standard no-color.org convention | ✓ |
| No, TTY detection only | Only check isTTY | |
| You decide | Claude picks | |

**User's choice:** Yes, respect both

### Parallel Summary Line

| Option | Description | Selected |
|--------|-------------|----------|
| Exit code per command | Summary with alias + exit code for each | ✓ |
| No summary | Just exit with code | |
| You decide | Claude picks | |

**User's choice:** Exit code per command, color-coded (green check / red cross)

### Single Command Prefix

| Option | Description | Selected |
|--------|-------------|----------|
| No prefix | Pass through transparently | ✓ |
| Optional prefix with --verbose | Prefix only in verbose mode | |
| You decide | Claude picks | |

**User's choice:** No prefix

### Sequential Chain Step Headers

| Option | Description | Selected |
|--------|-------------|----------|
| No separator | Continuous output flow | |
| Step header before each | Print ▶ alias before each step | ✓ |
| You decide | Claude picks | |

**User's choice:** Step header before each

---

## Parallel Kill & Signal Handling

### Kill Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Immediate SIGTERM + grace | Kill siblings immediately on failure | |
| Let others finish | Let all commands complete naturally | |
| Configurable per-alias | failMode: fast \| complete in commands.yml | ✓ |

**User's choice:** Configurable per-alias with `failMode: fast | complete`

### Default failMode

| Option | Description | Selected |
|--------|-------------|----------|
| fast | Kill siblings on first failure (default) | ✓ |
| complete | Let all finish | |

**User's choice:** fast

### Grace Period

| Option | Description | Selected |
|--------|-------------|----------|
| 3 seconds | Standard grace period | ✓ |
| 5 seconds | More generous | |
| You decide | Claude picks | |

**User's choice:** 3 seconds

### Ctrl+C Propagation

| Option | Description | Selected |
|--------|-------------|----------|
| Forward + clean exit | SIGTERM + grace, exit 130 | ✓ |
| Immediate kill | SIGKILL all immediately | |
| You decide | Claude picks | |

**User's choice:** Forward + clean exit

### failMode Validation

| Option | Description | Selected |
|--------|-------------|----------|
| Load-time validation | Validate at commands.yml load (Phase 3 pattern) | ✓ |
| Execution-time validation | Check only when running | |
| You decide | Claude picks | |

**User's choice:** Load-time validation, extending Phase 3 commands loader

---

## CLI Wiring Strategy

### Alias Registration

| Option | Description | Selected |
|--------|-------------|----------|
| Dynamic .command() per alias | Register each alias as commander sub-command | ✓ |
| Catch-all argument handler | Single catch-all with manual validation | |
| You decide | Claude picks | |

**User's choice:** Dynamic .command() per alias

### Load Timing

| Option | Description | Selected |
|--------|-------------|----------|
| Before commander parse | Load config+commands, register, then parse | ✓ |
| Lazy load in action handler | Parse first, load on alias invocation | |
| You decide | Claude picks | |

**User's choice:** Before commander parse

### No .loci/ Directory

| Option | Description | Selected |
|--------|-------------|----------|
| Graceful message + exit 0 | Friendly message, suggest loci init | ✓ |
| Error + exit non-zero | Treat as real error | |
| You decide | Claude picks | |

**User's choice:** Graceful message + exit 0

### No-Args Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Show alias list | Replace Phase 1 hint with real alias list | ✓ |
| Show help + alias list | Commander help then alias list | |
| You decide | Claude picks | |

**User's choice:** Show alias list (same as --list)

### --list vs No-Args

| Option | Description | Selected |
|--------|-------------|----------|
| Same output | Both show identical alias list | ✓ |
| Compact machine-friendly | --list outputs just names for scripting | |
| You decide | Claude picks | |

**User's choice:** Same output

### Per-Alias --help

| Option | Description | Selected |
|--------|-------------|----------|
| Description + command preview | Show type + steps/members preview | ✓ |
| Description only | Just description and options | |
| You decide | Claude picks | |

**User's choice:** Description + resolved command preview

### Unknown Alias Error

| Option | Description | Selected |
|--------|-------------|----------|
| Error + did-you-mean | Fuzzy match suggestion | |
| Error + list available | List all available aliases | ✓ |
| You decide | Claude picks | |

**User's choice:** Error + list available aliases

### Flag Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Per-alias | --dry-run and --verbose on each sub-command | ✓ |
| Top-level only | Flags must come before alias | |
| You decide | Claude picks | |

**User's choice:** Per-alias

### Project Root Discovery

| Option | Description | Selected |
|--------|-------------|----------|
| Walk up to find .loci/ | Walk parent dirs from cwd | ✓ |
| Strict cwd only | Only look in current directory | |
| You decide | Claude picks | |

**User's choice:** Walk up to find .loci/

### Unified Discovery

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, unified discovery | One step: find .loci/ + read LOCI_MACHINE_CONFIG | ✓ |
| Separate concerns | Keep them decoupled | |
| You decide | Claude picks | |

**User's choice:** Unified discovery

### Verbose Shows Root

| Option | Description | Selected |
|--------|-------------|----------|
| Yes | Print discovered root in --verbose | ✓ |
| No, only in errors | Show root only on errors | |
| You decide | Claude picks | |

**User's choice:** Yes

### failMode Schema Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Extend Phase 3 code | Add failMode validation to commands loader | ✓ |
| Phase 4 only | Handle entirely in Phase 4 | |
| You decide | Claude picks | |

**User's choice:** Extend Phase 3 code

### Exit Codes

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 1 ranges + child passthrough | Existing ranges confirmed | ✓ |
| Revisit ranges | Reconsider for Phase 4 | |

**User's choice:** Phase 1 ranges confirmed

---

## Dry-Run & Verbose Output Format

### --dry-run Format

| Option | Description | Selected |
|--------|-------------|----------|
| Structured preview | Type label, numbered steps, named entries, *** for secrets | ✓ |
| Shell-like format | Commands as shell strings with && and & | |
| You decide | Claude picks | |

**User's choice:** Structured preview

### --verbose Content

| Option | Description | Selected |
|--------|-------------|----------|
| Config trace + resolved command | Root, files, provenance, then execute | ✓ |
| Minimal trace | Just files loaded + command | |
| You decide | Claude picks | |

**User's choice:** Config trace + resolved command

### --verbose Execution

| Option | Description | Selected |
|--------|-------------|----------|
| Verbose + execute | --verbose traces AND runs the command | ✓ |
| Verbose = dry-run + info | --verbose implies no execution | |
| You decide | Claude picks | |

**User's choice:** Verbose + execute (--verbose --dry-run combo for trace without execution)

### Verbose Output Stream

| Option | Description | Selected |
|--------|-------------|----------|
| stderr | All diagnostic output to stderr | ✓ |
| stdout | Everything to stdout | |
| You decide | Claude picks | |

**User's choice:** stderr

### Env Vars in Dry-Run

| Option | Description | Selected |
|--------|-------------|----------|
| Only with --verbose | Env vars shown only with --verbose --dry-run | ✓ |
| Always in dry-run | Always show env vars | |
| You decide | Claude picks | |

**User's choice:** Only with --verbose

### Diagnostic Prefix Colors

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, dim/muted | Dim gray ANSI for [verbose]/[dry-run] | ✓ |
| No color on diagnostics | Plain text diagnostics | |
| You decide | Claude picks | |

**User's choice:** Yes, dim/muted

---

## Claude's Discretion

- Stderr handling strategy for parallel command prefixing (same stream vs merged)
- Internal executor architecture
- Line-buffering implementation approach
- Hash function for color assignment
- Exact dim ANSI codes for diagnostics
- Walk-up discovery module location
- failMode field placement in types.ts
- Unicode vs ASCII symbols for summary

## Deferred Ideas

None — discussion stayed within phase scope.
