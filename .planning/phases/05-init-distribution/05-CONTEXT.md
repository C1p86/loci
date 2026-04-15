# Phase 5: Init & Distribution - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers three things:
1. `loci init` command that scaffolds a `.loci/` directory in the user's project
2. Complete README with quickstart and reference documentation
3. npm publication under the name `xci`

This phase does NOT deliver: shell completions, `loci config` inspection, watch mode, or any v2 features.

</domain>

<decisions>
## Implementation Decisions

### npm Package Name
- **D-01:** Package name is `xci` (verified available on npm 2026-04-15). The binary command stays `loci` — only the npm package name changes. Install becomes `npm i -g xci`, but the user types `loci` to run it. All internal references (.loci/ directory, error messages, help text) remain "loci".

### `loci init` Scaffolding
- **D-02:** Example `commands.yml` contains a single hello-world alias only. Keep it minimal — the user learns by doing, not by reading a wall of YAML comments.
- **D-03:** `loci init` creates: `.loci/config.yml` (example with comments), `.loci/commands.yml` (hello world alias), `.loci/secrets.yml.example`, `.loci/local.yml.example`. Does NOT create the real secrets.yml or local.yml.
- **D-04:** Idempotent: existing files are never overwritten. Print what was created and what was skipped.

### .gitignore Handling
- **D-05:** Append `.loci/secrets.yml` and `.loci/local.yml` to `.gitignore` with a `# loci` comment header.
- **D-06:** If `.gitignore` already contains the entries, skip without duplicating. Print "skipped" in summary.
- **D-07:** If `.gitignore` does not exist, create it with ONLY the 2 loci entries (plus comment header). Do not generate a generic template — the tool doesn't know the project type.

### README
- **D-08:** Complete README: quickstart (install, `loci init`, first alias, run), full reference for 4 config levels, `commands.yml` format (single/sequential/parallel), platform overrides (`linux:`/`windows:`/`macos:`), `shell: false` default explanation with "wrap in script" pattern.
- **D-09:** Include a LICENSE file (MIT, already declared in package.json).

### Claude's Discretion
- Structure and ordering of README sections
- Exact wording of example config comments
- Whether to include badges in README (CI status, npm version, license)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Init Command (INIT-01 through INIT-06) — scaffolding acceptance criteria
- `.planning/REQUIREMENTS.md` §Documentation & Distribution (DOC-01 through DOC-05) — docs and publish criteria

### Prior Phase Context
- `.planning/phases/04-executor-cli/04-CONTEXT.md` — D-19 defines the "no .loci/ found" message that references `loci init`

### Project Configuration
- `package.json` — current name/version/bin/files fields; name must change from `loci` to `xci`
- `CLAUDE.md` §Publishing Workflow — ESM vs CJS, bin field, shebang, file permissions, exports, files field, prepublishOnly

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli.ts` — already has `buildProgram()` with commander setup; `loci init` will be registered as a new commander subcommand
- `src/errors.ts` — LociError hierarchy available for init-specific errors if needed
- `src/config/index.ts` — `configLoader` knows the exact file paths (.loci/config.yml, secrets.yml, local.yml); can be referenced for consistency

### Established Patterns
- Commander subcommands registered via `program.command()` with `.action()` async handler
- All output goes through `process.stdout.write()` / `process.stderr.write()` (no console.log)
- Errors use typed LociError subclasses with exit codes

### Integration Points
- `src/cli.ts main()` — init subcommand must be registered BEFORE the no-.loci/ check, so `loci init` works even when no `.loci/` exists yet
- `package.json` — name field changes from `loci` to `xci`; bin field stays `{"loci": "./dist/cli.mjs"}`
- `tsup.config.ts` — no changes expected (single entry point)

</code_context>

<specifics>
## Specific Ideas

- The hello world alias in commands.yml should be dead simple — user runs `loci hello` and sees output immediately
- README should be the kind you can follow top-to-bottom and have a working setup in under 2 minutes

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-init-distribution*
*Context gathered: 2026-04-15*
