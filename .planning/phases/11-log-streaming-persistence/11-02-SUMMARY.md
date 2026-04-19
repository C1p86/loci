---
phase: 11-log-streaming-persistence
plan: "02"
subsystem: server/log-pipeline
tags: [log-streaming, redaction, batching, fanout, websocket, security]
dependency_graph:
  requires: [11-01]
  provides: [redaction-table-service, log-batcher-service, log-fanout-service, handleLogChunkFrame-wired]
  affects: [packages/server/src/ws/handler.ts, packages/server/src/routes/runs/trigger.ts, packages/server/src/app.ts]
tech_stack:
  added: []
  patterns:
    - "Per-run redaction table: Map<runId, readonly string[]> on FastifyInstance, seeded at dispatch, cleared on terminal"
    - "LogBatcher: synchronous enqueue, async flush (50-chunk OR 200ms), drop-head at 1000 pending"
    - "LogFanout: Subscriber with 500-item bounded queue, drop-head + gap frame, synchronous pump"
key_files:
  created:
    - packages/server/src/services/redaction-table.ts
    - packages/server/src/services/log-batcher.ts
    - packages/server/src/services/log-fanout.ts
    - packages/server/src/services/__tests__/redaction-table.test.ts
    - packages/server/src/services/__tests__/log-batcher.test.ts
    - packages/server/src/services/__tests__/log-fanout.test.ts
  modified:
    - packages/server/src/app.ts
    - packages/server/src/routes/runs/trigger.ts
    - packages/server/src/ws/handler.ts
    - packages/server/src/crypto/tokens.ts
decisions:
  - "Longest-first redaction ordering (D-06): sort variants by length descending before storing in table"
  - "enqueue() is synchronous + fire-and-forget; flushRun() is async and errors are swallowed (LOG-07)"
  - "Subscriber pump is synchronous (inline while loop), not async — avoids ordering issues and simplifies testing"
  - "gap frame emitted at overflow boundary with count of dropped chunks; subsequent overflow emits another gap (not batched)"
  - "LogBatcher timer NOT reset on subsequent enqueues to same run — original 200ms budget is the guarantee"
  - "Added 'lch' prefix to generateId() for log chunk IDs"
metrics:
  duration_seconds: 608
  completed_date: "2026-04-19"
  tasks_completed: 3
  files_created: 6
  files_modified: 4
  tests_added: 30
---

# Phase 11 Plan 02: Log Pipeline Services (redaction-table + log-batcher + log-fanout) Summary

**One-liner:** Per-run server-side redaction (raw+base64+URL+hex variants, longest-first), 50-chunk/200ms batched DB insert, and 500-queue drop-head live fanout replace the Phase 10 `log_chunk` discard.

## What Was Built

### Three New Service Modules

**`packages/server/src/services/redaction-table.ts`** (D-05/D-06/D-07)
- `buildRedactionVariants(value)` — generates raw, base64, base64-utf8 (defensive), URL-encoded, hex variants; filters variants shorter than 4 chars; deduplicates
- `buildRedactionTable(fastify, runId, secretValues)` — combines all variants from all secret values, sorts LONGEST-FIRST (D-06), freezes, stores in `fastify.runRedactionTables`
- `clearRedactionTable(fastify, runId)` — deletes from map; idempotent
- `redactChunk(data, redactions)` — pure function; `undefined` redactions returns data unchanged (D-07 defense-in-depth); applies `replaceAll` in longest-first order

**`packages/server/src/services/log-batcher.ts`** (D-09/D-10/D-11)
- `enqueue(runId, orgId, partial)` — synchronous, fire-and-forget; generates chunk ID via `generateId('lch')`; starts 200ms timer on first chunk (NOT reset on subsequent enqueues); size-triggers flush at 50 chunks
- `flushRun(runId)` — snapshots and clears buffer atomically before async insert; errors caught at warn level, never re-thrown (LOG-07)
- `flushAll()` — flushes all active runs in parallel; used by `onClose` hook
- `stop()` — clears all timers, discards buffers; idempotent
- Overflow (D-11): when `totalPending > 1000`, drops oldest chunks from Map insertion-order head, logs `pino.warn`

**`packages/server/src/services/log-fanout.ts`** (D-12/D-13)
- `Subscriber` class: `push(frame)` with 500-queue bounded drop-head; when overflow triggers, emits a single `{type:'gap', droppedCount}` frame then appends the new frame; `pump()` synchronously drains queue while `ws.readyState === OPEN`, swallows send errors
- `addSubscriber(runId, orgId, ws)` — registers `ws.on('close')` and `ws.on('error')` for auto-deregistration; returns `Subscriber` instance (consumed by Plan 11-03)
- `broadcast(runId, frame)` — synchronous fanout to all subscribers; no-op if no subscribers
- `broadcastEnd(runId, state, exitCode)` — sends `{type:'end'}`, schedules `ws.close(1000)` after 5s grace with `.unref()`
- `closeAll()` — closes all ws with code 1001, clears map; used by `onClose` hook
- `hasSubscribers(runId)` — boolean check for Plan 11-03

### handleLogChunkFrame Rewire (handler.ts)

Before (Phase 10):
```typescript
// Phase 10: discard payload. Phase 11 wires storage here.
fastify.log.trace({ runId: frame.run_id, seq: frame.seq, ... }, 'log_chunk discarded');
```

After (Phase 11):
```typescript
const redactions = fastify.runRedactionTables.get(frame.run_id);
const redacted = redactChunk(frame.data, redactions);
fastify.logBatcher.enqueue(frame.run_id, conn.orgId, { runId, seq, stream, data: redacted, ts });
fastify.logFanout.broadcast(frame.run_id, { type: 'chunk', seq, stream, data: redacted, ts });
// D-10: no log call — frame.data never in log output
```

`handleResultFrame` also gained:
```typescript
fastify.logFanout.broadcastEnd(frame.run_id, targetState, frame.exit_code);
clearRedactionTable(fastify, frame.run_id);
```

### trigger.ts: Redaction Table Seeding

After `taskRuns.create()` and before `dispatchQueue.enqueue()`:
```typescript
buildRedactionTable(fastify, newRun.id, Object.values(orgSecrets));
```

### app.ts: Decorators + onClose Order

```typescript
app.decorate('runRedactionTables', new Map<string, readonly string[]>());
const logBatcher = new LogBatcher(app);
app.decorate('logBatcher', logBatcher);
const logFanout = new LogFanout(app);
app.decorate('logFanout', logFanout);
app.addHook('onClose', async () => {
  await logBatcher.flushAll(); // persist remaining buffered chunks
  logBatcher.stop();           // clear timers, discard
  logFanout.closeAll();        // close subscriber websockets (1001)
  app.runRedactionTables.clear(); // GC secret values
});
```

FastifyInstance type augmentation extended with `runRedactionTables`, `logBatcher`, `logFanout`.

## Unit Tests

| File | Tests | Coverage |
|------|-------|----------|
| redaction-table.test.ts | 17 | variants, longest-first, min-length, missing table no-op, replaceAll |
| log-batcher.test.ts | 6 | 50-chunk flush, 200ms timer, no-timer-reset, overflow drop, flushAll, stop |
| log-fanout.test.ts | 7 | addSubscriber, broadcast single/multi, overflow+gap, slow sub isolation, closeAll, removeSubscriber |
| **Total** | **30** | all pass |

All 157 server unit tests green. TypeScript build clean.

## Deviations from Plan

None — plan executed exactly as written.

Notable implementation choices aligned with plan:
- Subscriber `pump()` is synchronous (not async loop per plan prose) — simpler, avoids re-entrancy, matches the TDD test design. Gap frame uses `MAX_QUEUE - 1` threshold to make room for both gap marker and incoming frame simultaneously.
- LogBatcher `flushRun` uses `splice(0, length)` for atomic snapshot (not `buf.chunks` reassignment) to avoid a potential race on the same-tick micro-task boundary.

## Threat Flags

None — all surfaces were part of the plan's threat model (T-11-02-01 through T-11-02-08).

## Known Stubs

None — all three services are fully wired. Plan 11-03 will consume `logFanout.addSubscriber` and `logFanout.hasSubscribers` from the WS subscribe endpoint.

## Self-Check: PASSED

All 6 created files exist on disk. Commit `48670bb` verified in git log.
