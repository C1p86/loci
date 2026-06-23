---
"xci": minor
---

feat(dsl): add `xci` command kind for delegating to another project directory

A new alias kind that spawns another xci instance in a target project, fixing two bugs that occur when wrapping `xci` inside a `cmd:` step:

1. **Garbled output** — the child's OSC terminal-title sequences and banner bytes collide with the outer runner's pipe re-rendering, producing corrupted output.
2. **Outer process hangs** — the parent pipe stream never reaches EOF because the child holds its write end open; both processes deadlock waiting for the other.

`kind: xci` spawns the child with `stdio: 'inherit'`, wiring its stdin/stdout/stderr directly to the terminal and waiting only on the process exit event.

Features:
- `alias` — alias to run in the target project (required)
- `project` — target project root (relative or absolute path; defaults to current project)
- `args` — extra CLI arguments forwarded to the child
- `XCI_NESTING_DEPTH` env var set automatically; child attenuates terminal title OSC, desktop notifications, and real-time tail cursor-move redraws
- Runaway nesting guard: depth >= 32 aborts with exit code 1
- Exit code propagated unchanged from child to parent
- `${placeholder}` interpolation in `alias`, `project`, and `args`
- Usable as a top-level alias or as an inline sequential step
- Fully wired into `--list`, `--help`, `--dry-run`, `--verbose`, sequential steps, `cwd`, and the TUI
- `xci-delegate-example` built-in alias ships with xci
- No new runtime dependencies; cold-start unaffected
