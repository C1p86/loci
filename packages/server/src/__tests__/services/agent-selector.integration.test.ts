// Integration tests for agent-selector (Plan 10-03 Task 1).
// All tests use testcontainers Postgres — JSONB @> semantics require real DB.

import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { agents, taskRuns } from '../../db/schema.js';
import { makeAdminRepo } from '../../repos/admin.js';
import { makeTaskRunsRepo } from '../../repos/task-runs.js';
import { selectEligibleAgent } from '../../services/agent-selector.js';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import type { TaskSnapshot } from '../../ws/types.js';

const TASK_SNAPSHOT: TaskSnapshot = {
  task_id: 'xci_task_test',
  name: 'Test Task',
  description: 'Integration test task',
  yaml_definition: 'steps:\n  - run: echo hello',
  label_requirements: [],
};

/** Seed an agent with given labels, state, last_seen_at override, max_concurrent */
async function seedAgent(
  orgId: string,
  opts: {
    labels?: Record<string, string>;
    state?: 'online' | 'offline' | 'draining';
    lastSeenAt?: Date;
    maxConcurrent?: number;
  } = {},
): Promise<string> {
  const db = getTestDb();
  const admin = makeAdminRepo(db);
  const { agentId } = await admin.registerNewAgent({
    orgId,
    hostname: 'host',
    labels: opts.labels ?? {},
  });
  // Update state / lastSeenAt / maxConcurrent as needed
  const updates: Record<string, unknown> = {};
  if (opts.state !== undefined) updates.state = opts.state;
  if (opts.lastSeenAt !== undefined) updates.last_seen_at = opts.lastSeenAt;
  if (opts.maxConcurrent !== undefined) updates.max_concurrent = opts.maxConcurrent;
  if (Object.keys(updates).length > 0) {
    await db.execute(
      sql`UPDATE agents SET ${sql.raw(
        Object.keys(updates)
          .map((k) => `${k} = ${db.execute.length}`)
          .join(', '),
      )} WHERE id = ${agentId}`,
    );
    // Use drizzle update instead
    const setPayload = {} as Record<string, unknown>;
    if (opts.state !== undefined) setPayload.state = opts.state;
    if (opts.lastSeenAt !== undefined) setPayload.lastSeenAt = opts.lastSeenAt;
    if (opts.maxConcurrent !== undefined) setPayload.maxConcurrent = opts.maxConcurrent;
    await db.update(agents).set(setPayload).where(eq(agents.id, agentId));
  }

  return agentId;
}

/** Set agent to online state with fresh last_seen_at */
async function setAgentOnline(agentId: string): Promise<void> {
  const db = getTestDb();
  await db
    .update(agents)
    .set({ state: 'online', lastSeenAt: new Date() })
    .where(eq(agents.id, agentId));
}

/** Create an active run for an agent to count toward concurrency */
async function seedActiveRun(
  orgId: string,
  agentId: string,
  state: 'dispatched' | 'running' = 'running',
): Promise<string> {
  const db = getTestDb();
  const run = await makeTaskRunsRepo(db, orgId).create({
    taskId: 'xci_task_test',
    taskSnapshot: TASK_SNAPSHOT as unknown as Record<string, unknown>,
    timeoutSeconds: 3600,
  });
  await db.update(taskRuns).set({ state, agentId }).where(eq(taskRuns.id, run.id));
  return run.id;
}

describe('agent-selector integration (JSONB @> + concurrency + round-robin)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('Test 9: no candidates → returns null', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const result = await selectEligibleAgent(db, f.orgA.id, [], null);
    expect(result).toBeNull();
  });

  it('Test 10: label mismatch → returns null', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const agentId = await seedAgent(f.orgA.id, { labels: { os: 'linux' } });
    await setAgentOnline(agentId);

    const result = await selectEligibleAgent(db, f.orgA.id, ['os=windows'], null);
    expect(result).toBeNull();
  });

  it('Test 11: exact label match → returns that agent', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const agentId = await seedAgent(f.orgA.id, { labels: { os: 'linux', arch: 'x64' } });
    await setAgentOnline(agentId);

    const result = await selectEligibleAgent(db, f.orgA.id, ['os=linux'], null);
    expect(result).toBe(agentId);
  });

  it('Test 12: partial label match via @> containment → returns agent', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    // Agent has extra labels beyond what is required — should still match via @> containment
    const agentId = await seedAgent(f.orgA.id, {
      labels: { os: 'linux', arch: 'x64', extra: 'yes' },
    });
    await setAgentOnline(agentId);

    const result = await selectEligibleAgent(db, f.orgA.id, ['os=linux'], null);
    expect(result).toBe(agentId);
  });

  it('Test 13: agent at concurrency cap → excluded (returns null)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const agentId = await seedAgent(f.orgA.id, {
      labels: { os: 'linux' },
      maxConcurrent: 1,
    });
    await setAgentOnline(agentId);

    // Seed one active run — fills the concurrency slot
    await seedActiveRun(f.orgA.id, agentId, 'running');

    const result = await selectEligibleAgent(db, f.orgA.id, ['os=linux'], null);
    expect(result).toBeNull();
  });

  it('Test 14: least-busy agent wins', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const agent1 = await seedAgent(f.orgA.id, { labels: { os: 'linux' }, maxConcurrent: 5 });
    const agent2 = await seedAgent(f.orgA.id, { labels: { os: 'linux' }, maxConcurrent: 5 });
    await setAgentOnline(agent1);
    await setAgentOnline(agent2);

    // Give agent1 one active run
    await seedActiveRun(f.orgA.id, agent1, 'running');

    // agent2 has 0 active runs → should win
    const result = await selectEligibleAgent(db, f.orgA.id, ['os=linux'], null);
    expect(result).toBe(agent2);
  });

  it('Test 15: agent with stale last_seen_at (>60s ago) → excluded', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    await seedAgent(f.orgA.id, {
      labels: { os: 'linux' },
      state: 'online',
      // Set lastSeenAt to 2 hours ago
      lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    const result = await selectEligibleAgent(db, f.orgA.id, ['os=linux'], null);
    expect(result).toBeNull();
  });

  it('Test 16: draining agent → excluded', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    await seedAgent(f.orgA.id, {
      labels: { os: 'linux' },
      state: 'draining',
      lastSeenAt: new Date(),
    });

    const result = await selectEligibleAgent(db, f.orgA.id, ['os=linux'], null);
    expect(result).toBeNull();
  });

  it('Test 17: round-robin tiebreak — cursor advances to next agent', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    // Both agents have 0 active runs — tied. We want deterministic round-robin.
    // Create agents and ensure they have same active count (0).
    const agent1 = await seedAgent(f.orgA.id, { labels: { os: 'linux' }, maxConcurrent: 5 });
    const agent2 = await seedAgent(f.orgA.id, { labels: { os: 'linux' }, maxConcurrent: 5 });
    await setAgentOnline(agent1);
    await setAgentOnline(agent2);

    // With no cursor → returns first tied agent (by id ordering)
    const first = await selectEligibleAgent(db, f.orgA.id, ['os=linux'], null);
    expect([agent1, agent2]).toContain(first);

    // With cursor = first result → should rotate to the other agent
    const second = await selectEligibleAgent(db, f.orgA.id, ['os=linux'], first);
    expect(second).not.toBe(first);
    expect([agent1, agent2]).toContain(second);
  });
});
