# Phase 8: Agent Registration & WebSocket Protocol - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-04-18
**Phase:** 08-agent-registration-websocket-protocol
**Mode:** Auto-selected (user requested autonomous chain to milestone end)

All decisions in CONTEXT.md were auto-selected by Claude per user authorization. The key architectural calls:

| Decision | Choice | Why |
|----------|--------|-----|
| Phase 6 ws-fence | Lift in this phase: deps added to xci, grep gate removed, Biome rule narrowed to cli.ts only, lazy import preserves cold-start | Phase 8 IS the planned reversal point — fence existed only to prevent Phase 6 monorepo regressions |
| Agent loading | `await import()` from cli.ts when `--agent` argv detected pre-Commander | Only way to keep <300ms cold start green for non-agent paths |
| CLI surface | Top-level `--agent <url>` flag, NOT `xci agent` subcommand | PROJECT.md and ATOK-02 both spell `xci --agent <url> --token <T>` |
| Credential storage | XDG-compliant: `~/.config/xci/agent.json` (Linux/macOS), `%APPDATA%/xci/agent.json` (Win), 0600 perms | Agent is a daemon, not a project artifact |
| WS auth flow | Open-then-handshake (token in first frame, never URL) | ATOK-03 mandate; token-in-URL would be reflected in proxy logs |
| Frame envelope | JSON discriminated union; Phase 8 implements lifecycle frames + RESERVES dispatch/cancel/log_chunk/result for P10/P11 | Forward-compatible; downstream phases just add variants |
| Heartbeat | Server-driven WS ping every 25s, pong timeout 10s, offline = no message in 60s | AGENT-01 spec; 25s threads NAT/firewall typical 30-60s timeouts |
| Connection registry | In-memory `Map<agentId, WS>` per process, single-instance | Multi-instance scaling out of scope for v2.0 (deferred) |
| Reconciliation | Server authoritative on completed runs; agent authoritative on dispatch state | Phase 10 fully exercises with real runs; Phase 8 stubs the framework |
| Drain mode | API + state propagation only; "wait for in-flight" deferred to Phase 10 (no runs exist yet) | No-runs scope of Phase 8 |
| Token comparison | `crypto.timingSafeEqual` via centralized `compareToken()` helper | ATOK-06 mandate |
| Schema | 3 new tables (agents, agent_credentials, registration_tokens), all org-scoped via Phase 7 forOrg | Phase 7 architecture extends naturally |
| Repos | 3 new org-scoped repos + `adminRepo` cross-org helpers for handshake (org unknown until token validated) | Phase 7 D-01/D-03 pattern |
| Quota at registration (max_agents=5) | DEFERRED to Phase 10 per roadmap mapping | QUOTA-03 belongs to Phase 10 |
| Server tests | In-process WS pair via `app.listen({port:0})` + `ws` client | `fastify.inject` doesn't support WS upgrade |
| Agent tests | Mock server with `@fastify/websocket` harness; ONE E2E test spawning real agent process | Balanced coverage; full E2E expensive |
| Cold-start verification | Hyperfine gate stays + new unit smoke test in `xci/__tests__/cold-start.test.ts` | Defense-in-depth on the most fragile constraint |

## Deferred Ideas

See CONTEXT.md `<deferred>` section. Highlights:
- Multi-instance / Redis-backed registry → v2.1+
- mTLS for agent → v2.1+
- Audit log of agent actions → post-v2.0
- Quota enforcement → Phase 10
- Per-task WS frame schema validation via zod → revisit if envelope complexity grows
