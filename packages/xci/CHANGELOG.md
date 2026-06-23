# xci

## 0.3.0

### Minor Changes

- 5b6a5df: Phase 7: Bootstrap @xci/server package with database schema, authentication, sessions, and multi-tenant isolation. This is the first real code in @xci/server — previously a Phase 6 placeholder.

  - Drizzle ORM schema for orgs, users, org_members, org_plans, sessions, email_verifications, password_resets, org_invites
  - Argon2id password hashing (@node-rs/argon2)
  - Session cookie (httpOnly+secure+sameSite=strict) with sliding 14d expiry, absolute 30d cap
  - Email verification, password reset, org invite flows
  - Multi-tenant isolation via scoped repository wrapper (forOrg) + two-org integration fixture
  - Free org plan entity (max_agents=5, max_concurrent_tasks=5, log_retention_days=30) — enforcement in Phase 10

- 32c4887: feat(phase-08): agent registration scaffold (Phase 6 fence partially reversed)

  - xci: add `ws`, `reconnecting-websocket`, `env-paths` deps; lazy-loaded agent module entry (`dist/agent.mjs`) behind `--agent` flag
  - @xci/server: add `agents`, `agent_credentials`, `registration_tokens` tables (org-scoped, Phase 7 forOrg pattern)
  - CI: removed WS-exclusion grep gate (agent mode legitimately uses ws)
  - Biome: narrowed ws-restriction to packages/xci/src/cli.ts only; agent module may import ws/reconnecting-websocket

  No user-facing agent flows yet (Plans 08-02 through 08-04 deliver the full protocol).

- 8aafe42: feat(dsl): add `uproject` command kind for Unreal Engine `.uproject` files

  A new alias kind that edits a UE `.uproject` file (JSON) declaratively — detected by an `uproject:` key:

  - `plugins.enable` — set `Enabled: true` on an existing entry, or append `{ Name, Enabled: true }` if absent
  - `plugins.disable` — set `Enabled: false`, preserving the entry's other fields
  - `plugins.remove` — delete the entry from the `Plugins` array
  - `set` — assign top-level fields (e.g. `EngineAssociation`, `Description`)

  Semantics: missing/redundant operations (disable/remove an absent plugin, enable/add an already-enabled one) emit a stderr warning and exit `0` — never an error, so aliases are idempotent. The file is written back with 2-space indentation and a trailing newline; `${placeholder}` is interpolated in the path and `set` values. Fully wired into `--list`, `--help`, `--dry-run`, `--verbose`, sequential steps, `cwd`, and the TUI. A `ue-enable-plugins` built-in example ships with xci. Uses native JSON only — no new dependency, cold-start unaffected.

- 3cd5c18: feat(dsl): add `xci` command kind for delegating to another project directory

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
