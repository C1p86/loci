---
"xci": minor
---

feat(dsl): add `uproject` command kind for Unreal Engine `.uproject` files

A new alias kind that edits a UE `.uproject` file (JSON) declaratively — detected by an `uproject:` key:

- `plugins.enable` — set `Enabled: true` on an existing entry, or append `{ Name, Enabled: true }` if absent
- `plugins.disable` — set `Enabled: false`, preserving the entry's other fields
- `plugins.remove` — delete the entry from the `Plugins` array
- `set` — assign top-level fields (e.g. `EngineAssociation`, `Description`)

Semantics: missing/redundant operations (disable/remove an absent plugin, enable/add an already-enabled one) emit a stderr warning and exit `0` — never an error, so aliases are idempotent. The file is written back with 2-space indentation and a trailing newline; `${placeholder}` is interpolated in the path and `set` values. Fully wired into `--list`, `--help`, `--dry-run`, `--verbose`, sequential steps, `cwd`, and the TUI. A `ue-enable-plugins` built-in example ships with xci. Uses native JSON only — no new dependency, cold-start unaffected.
