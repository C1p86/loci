# Phase 6 Plan 01 — npm scope @xci verification (per D-14)

**Executed:** 2026-04-18
**Decision:** AVAILABLE

## Command: `npm view @xci/server`

```
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@xci%2fserver - Not found
npm error 404
npm error 404  '@xci/server@*' is not in this registry.
npm error 404
npm error 404 Note that you can also install from a
npm error 404 tarball, folder, http url, or git url.
npm error A complete log of this run can be found in: /home/developer/.npm/_logs/2026-04-18T15_59_42_878Z-debug-0.log
EXIT=1
```

## Command: `npm view @xci/web`

```
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@xci%2fweb - Not found
npm error 404
npm error 404  '@xci/web@*' is not in this registry.
npm error 404
npm error 404 Note that you can also install from a
npm error 404 tarball, folder, http url, or git url.
npm error A complete log of this run can be found in: /home/developer/.npm/_logs/2026-04-18T15_59_43_553Z-debug-0.log
EXIT=1
```

## Interpretation

- Exit code non-zero + "404" / "E404" in stderr → name is AVAILABLE (we can publish under this name).
- Exit code 0 + JSON manifest on stdout → name is TAKEN (someone else owns it).

Both commands returned `npm error code E404` with `EXIT=1` and the error body `'@xci/server@*' is not in this registry` / `'@xci/web@*' is not in this registry`. Per D-14's interpretation rubric, this is the AVAILABLE signal — no published package exists under either scoped name, so the `@xci` scope can be claimed by our publish flow on first release.

## Decision

- [x] AVAILABLE: both commands returned 404/E404. Proceed to Plan 02 unchanged — `@xci/server` and `@xci/web` are the confirmed package names.
- [ ] TAKEN: at least one command returned a manifest. HALT Phase 6 execution. Escalate to user via `checkpoint:decision` in next task to choose a fallback scope (e.g. `@xcihq/server` + `@xcihq/web`, or `@xci-io/server` + `@xci-io/web`). Plans 02-06 must be updated to the chosen scope before execution.

## Result summary (fill one)

- [x] Both names 404 — PROCEED (default expected outcome)
- [ ] `@xci/server` TAKEN — HALT
- [ ] `@xci/web` TAKEN — HALT
- [ ] Both TAKEN — HALT
