---
phase: 10-dispatch-pipeline-quota-enforcement
plan: "01"
subsystem: database
tags: [drizzle, postgres, schema, task-runs, state-machine, repo, isolation-test, quota]

requires:
  - phase: 09-task-definitions-secrets-management
    provides: tasks table + makeTasksRepo + dispatch-resolver (resolveTaskParams)
  - phase: 08-agent-registration-websocket-protocol
    provides: agents table + makeAgentsRepo
  - phase: 07-database-schema-auth
    provides: orgs/users/orgPlans schema + forOrg factory + D-01/D-04 discipline

provides:
  - task_runs table (8-state machine, 18 columns, 4 indexes, 5 FK constraints)
  - agents.max_concurrent column (DEFAULT 1, backfills existing rows)
  - tasks.default_timeout_seconds column (NULLABLE)
  - makeTaskRunsRepo factory with 9 org-scoped methods + atomic CAS transitions
  - adminRepo extensions: countConcurrentByOrg, countAgentsByOrg, findRunsForReconciliation
  - 5 new error classes: RunNotFoundError, RunAlreadyTerminalError, RunStateTransitionError, RunQuotaExceededError, AgentQuotaExceededError, NoEligibleAgentError
  - D-04 two-org isolation test (task-runs.isolation.test.ts, 7 per-method cross-tenant checks)
  - Drizzle migration 0003_task_runs.sql committed

affects:
  - 10-02 (frame router consumes verifyBelongsToOrg + updateStateMulti + updateState)
  - 10-03 (reconciler uses listByState, updateStateMulti, adminRepo.findRunsForReconciliation)
  - 10-04 (dispatch routes use forOrg().taskRuns.create + adminRepo.countConcurrentByOrg)
  - 10-05 (quota gate uses adminRepo.countAgentsByOrg)

tech-stack:
  added: []
  patterns:
    - "Atomic CAS state transition: UPDATE ... WHERE id=X AND org_id=Y AND state=expected RETURNING *"
    - "Multi-source CAS: inArray(state, expectedStates) for multi-origin transitions (timeout, orphan)"
    - "markTerminal wraps updateStateMulti for ['dispatched','running'] → terminal states"
    - "adminRepo cross-org namespace used for quota counts and reconciliation (D-03)"
    - "D-04 isolation test seeds both orgs per it() to prevent empty-org false positives"

key-files:
  created:
    - packages/server/drizzle/0003_task_runs.sql
    - packages/server/drizzle/meta/0003_snapshot.json
    - packages/server/src/repos/task-runs.ts
    - packages/server/src/repos/__tests__/task-runs.isolation.test.ts
  modified:
    - packages/server/drizzle/meta/_journal.json
    - packages/server/src/db/schema.ts
    - packages/server/src/db/relations.ts
    - packages/server/src/crypto/tokens.ts
    - packages/server/src/repos/admin.ts
    - packages/server/src/repos/for-org.ts
    - packages/server/src/errors.ts
    - biome.json

key-decisions:
  - "CAS pattern: all state transitions use UPDATE...WHERE state=expected RETURNING * — undefined return = CAS miss, no throw"
  - "orgId included in every CAS WHERE clause (T-10-01-03 frame spoofing guard)"
  - "markTerminal accepts exitCode even for cancel/orphan paths — caller passes -1 for non-exit-code cases"
  - "adminRepo.findRunsForReconciliation is cross-org by design (D-03/D-30 boot scan)"
  - "task_snapshot stored as JSONB — full task def at dispatch time, never re-queried into (DISP-09 reproducibility)"
  - "No mek param on makeTaskRunsRepo — task_runs stores plain-object JSONB, MEK is dispatch-resolver responsibility"

patterns-established:
  - "CAS update returns undefined on miss — callers do NOT throw from the repo layer, they throw from service/handler layer"
  - "D-04 isolation test helper seedRunInOrg: seeds task via makeTasksRepo then run via makeTaskRunsRepo, both scoped to same orgId"

requirements-completed: [DISP-04, QUOTA-03, QUOTA-04]

duration: ~35min (interrupted by API error mid-execution, resumed to completion)
completed: "2026-04-19"
---

# Phase 10 Plan 01: task_runs Schema + Repo + Isolation Test Summary

**Drizzle migration 0003_task_runs.sql, makeTaskRunsRepo with atomic CAS state machine (8 states), adminRepo quota/reconciliation extensions, and D-04 two-org isolation test**

## Performance

- **Duration:** ~35 min (tasks 1 and 2 executed in one session; task 3 resumed after API error)
- **Started:** 2026-04-19T00:51:00Z
- **Completed:** 2026-04-19T12:12:00Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Generated and committed Drizzle migration `0003_task_runs.sql` with CREATE TABLE, 2 ALTER TABLEs (agents + tasks), 4 CREATE INDEXes, and 5 FK constraints
- Created `makeTaskRunsRepo(db, orgId)` with 9 org-scoped methods including atomic CAS `updateState` / `updateStateMulti` and `verifyBelongsToOrg` frame-spoofing guard
- Extended `adminRepo` with `countConcurrentByOrg`, `countAgentsByOrg`, `findRunsForReconciliation` for quota enforcement and boot-time reconciliation
- Added 6 error classes to errors.ts (`RunNotFoundError`, `RunAlreadyTerminalError`, `RunStateTransitionError`, `RunQuotaExceededError`, `AgentQuotaExceededError`, `NoEligibleAgentError`)
- Written 7-test two-org isolation test file; D-04 auto-discovery meta-test picks it up; 88 unit tests green; 328 v1 xci tests green (BC-01/BC-02)

## Migration File

**Filename:** `packages/server/drizzle/0003_task_runs.sql`

First 3 lines of generated SQL:
```sql
CREATE TABLE "task_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
```

## Task-Runs Repo Method Signatures

```typescript
export function makeTaskRunsRepo(db: PostgresJsDatabase, orgId: string): {
  create(params: {
    taskId: string;
    taskSnapshot: Record<string, unknown>;
    paramOverrides?: Record<string, string>;
    triggeredByUserId?: string;
    timeoutSeconds?: number;
  }): Promise<TaskRun>;

  getById(runId: string): Promise<TaskRun | undefined>;

  list(opts: {
    state?: TaskRunState | TaskRunState[];
    taskId?: string;
    since?: Date;
    limit?: number;
  }): Promise<TaskRun[]>;

  listActiveByAgent(agentId: string): Promise<TaskRun[]>;

  listByState(states: TaskRunState[]): Promise<TaskRun[]>;

  updateState(
    runId: string,
    expectedState: TaskRunState,
    newState: TaskRunState,
    extra?: Partial<NewTaskRun>,
  ): Promise<TaskRun | undefined>;

  updateStateMulti(
    runId: string,
    expectedStates: TaskRunState[],
    newState: TaskRunState,
    extra?: Partial<NewTaskRun>,
  ): Promise<TaskRun | undefined>;

  markTerminal(
    runId: string,
    newState: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'orphaned',
    exitCode: number,
  ): Promise<TaskRun | undefined>;

  verifyBelongsToOrg(runId: string): Promise<boolean>;
}

export type TaskRunsRepo = ReturnType<typeof makeTaskRunsRepo>;
```

## AdminRepo New Method Signatures

```typescript
// Added to makeAdminRepo() return object:
countConcurrentByOrg(orgId: string): Promise<number>;
countAgentsByOrg(orgId: string): Promise<number>;
findRunsForReconciliation(): Promise<TaskRun[]>;
```

## Task Commits

1. **Task 1: Schema extensions + Drizzle migration 0003_task_runs.sql** - `0ba4e07` (feat)
2. **Task 2: makeTaskRunsRepo + adminRepo extensions + error classes + biome D-01 fence** - `f7aa5c0` (feat)
3. **Task 3: Two-org isolation test (D-04)** - `0ce0e86` (test)

**Plan metadata:** (this commit — docs)

## Files Created/Modified

- `packages/server/drizzle/0003_task_runs.sql` - Migration: CREATE TABLE task_runs + 2 ALTER TABLEs + 4 indexes + 5 FKs
- `packages/server/drizzle/meta/0003_snapshot.json` - Drizzle meta snapshot (generated)
- `packages/server/drizzle/meta/_journal.json` - Updated migration journal
- `packages/server/src/db/schema.ts` - taskRuns table + agents.maxConcurrent + tasks.defaultTimeoutSeconds + type exports
- `packages/server/src/db/relations.ts` - Drizzle relations for taskRuns
- `packages/server/src/crypto/tokens.ts` - Added 'run' to generateId prefix union
- `packages/server/src/repos/task-runs.ts` - New: makeTaskRunsRepo factory (9 methods)
- `packages/server/src/repos/admin.ts` - 3 new methods: countConcurrentByOrg, countAgentsByOrg, findRunsForReconciliation
- `packages/server/src/repos/for-org.ts` - Wire taskRuns: makeTaskRunsRepo(db, orgId) into factory
- `packages/server/src/errors.ts` - 6 new error classes for task-run state machine
- `biome.json` - D-01 fence extended: block direct imports of task-runs.js + tasks.js
- `packages/server/src/repos/__tests__/task-runs.isolation.test.ts` - New: 7 per-method cross-tenant checks

## D-04 Auto-Discovery Status

`isolation-coverage.isolation.test.ts` scans `src/repos/*.ts`. `task-runs.ts` exports `makeTaskRunsRepo`. The new `task-runs.isolation.test.ts` references `makeTaskRunsRepo` by name (import + call). Auto-discovery: **PASSES** (D-04 comment in file header).

## BC Fence Status

| Suite | Tests | Status |
|-------|-------|--------|
| pnpm --filter xci test (v1 302+) | 328 | green |
| pnpm --filter @xci/server test:unit | 88 | green |
| tsc --noEmit (@xci/server) | — | clean |

## Decisions Made

- CAS update returns `undefined` on miss — repos do not throw; service/handler layer decides the appropriate error (RunAlreadyTerminalError, etc.)
- `orgId` included in every CAS WHERE clause (T-10-01-03 frame spoofing guard) — architectural invariant
- `findRunsForReconciliation()` has no orgId param (adminRepo cross-tenant by design D-03/D-30)
- `task_snapshot` stored as JSONB not FK to tasks.yamlDefinition — run must use task def AS OF dispatch time (DISP-09 reproducibility)
- No `mek` on makeTaskRunsRepo — snapshots are plain objects; MEK responsibility belongs to dispatch-resolver (Phase 9)
- Drizzle migration path changed from `packages/server/src/drizzle/` to `packages/server/drizzle/` (corrected per existing project layout)

## Deviations from Plan

**1. [Rule 1 - Bug] Migration path corrected**
- **Found during:** Task 1
- **Issue:** PLAN.md listed migration path as `packages/server/src/drizzle/` but the actual drizzle output path in the project is `packages/server/drizzle/`
- **Fix:** Used correct path `packages/server/drizzle/` matching existing migrations (0000, 0001, 0002)
- **Committed in:** `0ba4e07`

**2. [Rule 1 - Bug] Added RunStateTransitionError**
- **Found during:** Task 2
- **Issue:** PLAN.md specified 5 error classes; implementation added `RunStateTransitionError` (409) as a distinct class from `RunAlreadyTerminalError` to cover mid-state transition failures vs terminal-state idempotency
- **Fix:** Added as 6th error class alongside the planned 5
- **Committed in:** `f7aa5c0`

**3. [Rule 3 - Blocking] API error interrupted execution between tasks 2 and 3**
- **Found during:** Task 3 start
- **Issue:** Anthropic API error (overloaded) interrupted the agent after task 2 commit; task 3 was not executed
- **Fix:** Continuation agent completed task 3 from committed state
- **No code impact** — tasks 1 and 2 commits were clean

---

**Total deviations:** 3 (2 auto-fixed inline, 1 execution interruption)
**Impact on plan:** No scope creep. All fixes necessary for correctness. API interruption had no code impact.

## Issues Encountered

API error (Anthropic overload) between tasks 2 and 3 — continuation agent resumed cleanly from committed state. Tasks 1 and 2 commits (`0ba4e07`, `f7aa5c0`) were intact.

## Handoff Note for Plan 10-02

Plan 10-02 (WS frame router) consumes:
- `forOrg(orgId).taskRuns.verifyBelongsToOrg(frame.run_id)` — frame spoofing guard (T-10-01-03)
- `forOrg(orgId).taskRuns.updateStateMulti(runId, ['dispatched','running'], 'running', ...)` — `handleResultFrame`
- `forOrg(orgId).taskRuns.updateState(runId, 'queued', 'dispatched', { agentId })` — `handleStateAck`
- `forOrg(orgId).taskRuns.markTerminal(runId, 'succeeded'|'failed', exitCode)` — result frame handler

## Next Phase Readiness

- Persistence substrate complete — all downstream Phase 10 plans have a stable repo API
- Plan 10-02 (frame router) and Plan 10-03 (reconciler) can proceed in parallel
- Plan 10-04 (dispatch routes) depends on Plan 10-02 + 10-03 being wired
- Integration tests (testcontainers Postgres) verify migration apply at boot — run `pnpm --filter @xci/server test:integration` on Linux/CI

---
*Phase: 10-dispatch-pipeline-quota-enforcement*
*Completed: 2026-04-19*
