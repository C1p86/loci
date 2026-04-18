---
"xci": minor
"@xci/server": minor
---

feat(phase-08): agent registration scaffold (Phase 6 fence partially reversed)

- xci: add `ws`, `reconnecting-websocket`, `env-paths` deps; lazy-loaded agent module entry (`dist/agent.mjs`) behind `--agent` flag
- @xci/server: add `agents`, `agent_credentials`, `registration_tokens` tables (org-scoped, Phase 7 forOrg pattern)
- CI: removed WS-exclusion grep gate (agent mode legitimately uses ws)
- Biome: narrowed ws-restriction to packages/xci/src/cli.ts only; agent module may import ws/reconnecting-websocket

No user-facing agent flows yet (Plans 08-02 through 08-04 deliver the full protocol).
