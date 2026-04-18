# Changesets

This directory is managed by [Changesets](https://github.com/changesets/changesets).

## Recording a change

When you make a change to any package that should trigger a release:

```bash
pnpm changeset
```

Follow the prompts. The tool writes a markdown file in this directory (e.g. `.changeset/fluffy-llamas-sing.md`). Commit it along with your code change.

## Releasing

1. On push to `main`, the `Release` GitHub Actions workflow runs `changesets/action@v1`.
2. The action aggregates all pending changesets and opens a "Version PR" that bumps package versions and updates CHANGELOG entries.
3. When the Version PR is merged, the action runs `pnpm -r publish --access=public` to push all three packages (`xci`, `@xci/server`, `@xci/web`) to npm.

## Fixed-versioning

`xci`, `@xci/server`, and `@xci/web` are locked together via `.changeset/config.json` -> `"fixed": [["xci", "@xci/server", "@xci/web"]]`. A bump to any one bumps all three.

In Phase 6, `@xci/server` and `@xci/web` are `"private": true` -- they are NOT published. Real implementations land in Phase 9+ (server) and Phase 13+ (web), at which point their `private` flag flips to `false` in the same commit that ships their code.
