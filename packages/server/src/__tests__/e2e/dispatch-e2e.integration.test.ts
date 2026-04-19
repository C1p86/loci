// E2E integration test: real xci agent + real Fastify server + real DB.
// Proves the full dispatch pipeline: trigger → queued → dispatched → running → succeeded.
// Linux-only (process.platform === 'linux') per D-42.
// Requires: pnpm --filter xci build (dist/agent.mjs must exist).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { generateId } from '../../crypto/tokens.js';
import { tasks } from '../../db/schema.js';
import { makeRepos } from '../../repos/index.js';
import { makeRegistrationTokensRepo } from '../../repos/registration-tokens.js';
import { clearAllRunTimers } from '../../services/timeout-manager.js';
import { getTestDb, getTestMek, resetDb, TEST_MEK } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';

const isLinux = process.platform === 'linux';

// Resolve the xci dist agent bundle relative to this test file:
// packages/server/src/__tests__/e2e/ → packages/server/ → packages/ → packages/xci/dist/agent.mjs
const xciDistAgent = join(import.meta.dirname, '../../../../xci/dist/agent.mjs');
const canRun = isLinux && existsSync(xciDistAgent);

describe.runIf(canRun)('dispatch E2E (D-42, Linux-only, real xci agent + real server)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let port: number;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'warn' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    clearAllRunTimers();
    await app.close();
  });

  beforeEach(async () => {
    clearAllRunTimers();
    await resetDb();
  });

  it(
    'happy path: trigger echo task → agent receives dispatch → state=succeeded + exit_code=0',
    async () => {
      const db = getTestDb();
      const mek = getTestMek();
      const repos = makeRepos(db, mek);

      // 1. Seed org + owner
      const f = await seedTwoOrgs(db);
      const orgId = f.orgA.id;
      const userId = f.orgA.ownerUser.id;

      // 2. Create a registration token
      const { tokenPlaintext } = await makeRegistrationTokensRepo(db, orgId).create(userId);

      // 3. Create a task with yaml_definition: a single command "echo hello from xci"
      const taskId = generateId('tsk');
      await db.insert(tasks).values({
        id: taskId,
        orgId,
        name: 'e2e-echo-task',
        description: 'E2E dispatch test task',
        yamlDefinition: 'echo hello from xci',
        labelRequirements: [],
      });

      // 4. Create isolated config dir for agent credential
      const configDir = join(
        tmpdir(),
        `xci-dispatch-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      await mkdir(configDir, { recursive: true });

      try {
        // 5. Spawn real xci agent
        const agentProc = spawn(
          process.execPath,
          [
            xciDistAgent,
            '--agent',
            `ws://127.0.0.1:${port}/ws/agent`,
            '--token',
            tokenPlaintext,
            '--config-dir',
            configDir,
          ],
          {
            cwd: configDir,
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );

        let agentStderr = '';
        agentProc.stderr?.on('data', (d: Buffer) => {
          agentStderr += d.toString();
        });

        // 6. Wait for agent to register (credential file appears)
        const credPath = join(configDir, 'agent.json');
        const regDeadline = Date.now() + 10_000;
        while (!existsSync(credPath) && Date.now() < regDeadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(
          existsSync(credPath),
          `Agent did not register within 10s; stderr: ${agentStderr}`,
        ).toBe(true);

        // 7. Create a session + CSRF for the owner user
        const { token: sessionToken } = await repos.admin.createSession({
          userId,
          activeOrgId: orgId,
        });

        const csrfRes = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
        const csrfToken = csrfRes.json<{ csrfToken: string }>().csrfToken;
        const rawSetCookie = csrfRes.headers['set-cookie'];
        const csrfCookieVal =
          typeof rawSetCookie === 'string'
            ? (rawSetCookie.split(';')[0] ?? '')
            : ((rawSetCookie as string[])[0]?.split(';')[0] ?? '');
        const cookie = `session=${sessionToken}; ${csrfCookieVal}`;

        // 8. Trigger a run via REST
        const triggerRes = await app.inject({
          method: 'POST',
          url: `/api/orgs/${orgId}/tasks/${taskId}/runs`,
          headers: { cookie, 'x-csrf-token': csrfToken },
          payload: {},
        });
        expect(triggerRes.statusCode, `trigger failed: ${triggerRes.body}`).toBe(201);
        const { runId } = triggerRes.json<{ runId: string; state: string }>();
        expect(runId).toMatch(/^xci_run_/);

        // 9. Poll GET /api/orgs/:orgId/runs/:runId until state=succeeded or timeout 30s
        const terminalStates = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'orphaned']);
        const pollDeadline = Date.now() + 30_000;
        let finalState = '';
        let finalRun: Record<string, unknown> | null = null;

        while (Date.now() < pollDeadline) {
          const runRes = await app.inject({
            method: 'GET',
            url: `/api/orgs/${orgId}/runs/${runId}`,
            headers: { cookie },
          });
          if (runRes.statusCode === 200) {
            const body = runRes.json<Record<string, unknown>>();
            finalState = String(body['state'] ?? '');
            if (terminalStates.has(finalState)) {
              finalRun = body;
              break;
            }
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        expect(
          finalState,
          `Run did not reach terminal state within 30s; last state: ${finalState}; agent stderr: ${agentStderr}`,
        ).toBe('succeeded');
        expect(finalRun?.['exit_code']).toBe(0);
        expect(Number(finalRun?.['duration_ms'])).toBeGreaterThan(0);

        // 10. SIGTERM agent → graceful exit 0 (AGENT-08)
        agentProc.kill('SIGTERM');
        const agentExitCode = await new Promise<number>((resolve) => {
          agentProc.once('exit', (code) => resolve(code ?? 1));
        });
        expect(agentExitCode, `Agent exited with non-zero code: ${agentExitCode}\nagent stderr: ${agentStderr}`).toBe(0);
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }
    },
    45_000,
  );
});

// Skip message when canRun is false
if (!canRun) {
  describe('dispatch E2E (D-42, Linux-only, real xci agent + real server)', () => {
    it.skip(
      `skipped: platform=${process.platform}, xciDistAgent exists=${existsSync(xciDistAgent)}`,
      () => {},
    );
  });
}
