# Phase 11: Log Streaming & Persistence - Discussion Log

**Date:** 2026-04-19
**Mode:** Auto-selected — 31 locked decisions for log persistence + live fanout + retention.

Key calls:
- log_chunks table is org-scoped via task_runs join (not direct FK) to keep table lean
- text data column (no app-layer compression; Postgres TOAST handles it)
- (run_id, seq) unique index prevents dup chunks on replay
- Batched inserts (200ms/50 chunks) for DB efficiency
- Drop-head bounded queue per subscriber (LOG-07 — preserve tail)
- Per-run redaction table cached server-side at dispatch; agent also redacts local secrets
- Redaction covers base64/URL-encoded/hex variants (min 4 chars)
- Retention cleanup via DELETE USING JOIN, batched 10k rows, setInterval 24h
- Plaintext `.log` download streaming (not buffered)
- WS subscribe endpoint with sinceSeq catch-up for reconnect resume
- Startup cleanup runs immediately on boot

See CONTEXT.md for full decision list.
