// E2E integration test: spawns real xci CLI child process against real Fastify+WS server.
// Linux-only (process.platform === 'linux') per D-33.
// Requires: pnpm --filter xci build (dist/cli.mjs must exist).
// In CI: pnpm turbo run build always precedes test:integration.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { makeRepos } from '../repos/index.js';
import { makeRegistrationTokensRepo } from '../repos/registration-tokens.js';
import { getTestDb, resetDb, TEST_MEK } from '../test-utils/db-harness.js';
import { seedTwoOrgs } from '../test-utils/two-org-fixture.js';

const isLinux = process.platform === 'linux';

// Resolve the xci dist bundle relative to this test file:
// packages/server/src/__tests__/ → packages/server/ → packages/ → packages/xci/dist/cli.mjs
const xciDistCli = join(import.meta.dirname, '../../../xci/dist/cli.mjs');
const canRun = isLinux && existsSync(xciDistCli);

describe.runIf(canRun)('agent E2E (D-33, Linux-only, real xci subprocess)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let port: number;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'warn' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it('xci --agent + --token → full registration flow; credential written to --config-dir', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { tokenPlaintext } = await makeRegistrationTokensRepo(db, f.orgA.id).create(
      f.orgA.ownerUser.id,
    );

    const configDir = join(
      tmpdir(),
      `xci-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(configDir, { recursive: true });
    try {
      const proc = spawn(
        process.execPath,
        [
          xciDistCli,
          '--agent',
          `ws://127.0.0.1:${port}/ws/agent`,
          '--token',
          tokenPlaintext,
          '--config-dir',
          configDir,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      // Collect stderr for debugging if assertion fails
      let stderrOutput = '';
      proc.stderr?.on('data', (d: Buffer) => {
        stderrOutput += d.toString();
      });

      // Wait for agent.json to appear (up to 10s)
      const credPath = join(configDir, 'agent.json');
      const deadline = Date.now() + 10_000;
      while (!existsSync(credPath) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(existsSync(credPath), `agent.json missing; stderr: ${stderrOutput}`).toBe(true);

      const cred = JSON.parse(await readFile(credPath, 'utf8')) as Record<string, unknown>;
      expect(cred['version']).toBe(1);
      expect(cred['agent_id']).toMatch(/^xci_agt_/);
      expect(typeof cred['credential']).toBe('string');
      expect((cred['credential'] as string).length).toBeGreaterThanOrEqual(40);
      expect(cred['server_url']).toContain(`ws://127.0.0.1:${port}`);

      // Verify agent appears in DB via adminRepo
      const repos = makeRepos(db, TEST_MEK);
      const dbCred = await repos.admin.findActiveAgentCredential(cred['credential'] as string);
      expect(dbCred, 'agent credential not found in DB').not.toBeNull();
      expect(dbCred?.agentId).toBe(cred['agent_id']);

      // AGENT-08: SIGTERM → goodbye frame → graceful exit(0)
      proc.kill('SIGTERM');
      const exitCode = await new Promise<number>((resolve) => {
        proc.once('exit', (code) => resolve(code ?? 1));
      });
      expect(exitCode).toBe(0);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  }, 20_000);

  it('xci --agent + --token + existing credential file → TOFU error, exit non-zero (D-09)', async () => {
    const configDir = join(
      tmpdir(),
      `xci-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(configDir, { recursive: true });
    try {
      // Pre-write a fake credential file to trigger TOFU guard
      const fakeCred = {
        version: 1,
        server_url: 'ws://fake',
        agent_id: 'xci_agt_prior',
        credential: 'prior-cred-value',
        registered_at: new Date().toISOString(),
      };
      await writeFile(join(configDir, 'agent.json'), JSON.stringify(fakeCred));

      const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
        const proc = spawn(
          process.execPath,
          [
            xciDistCli,
            '--agent',
            `ws://127.0.0.1:${port}/ws/agent`,
            '--token',
            'reg-token-xxx',
            '--config-dir',
            configDir,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stderr = '';
        proc.stderr?.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        proc.once('exit', (code) => resolve({ code: code ?? 1, stderr }));
      });

      expect(result.code).not.toBe(0);
      // Should mention "already registered" in the error message
      expect(result.stderr).toMatch(/already registered|AGENT_MODE_ARGS|Agent mode/i);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  }, 10_000);
});

// When canRun is false, emit a descriptive skip message
if (!canRun) {
  describe('agent E2E (D-33, Linux-only, real xci subprocess)', () => {
    it.skip(`skipped: platform=${process.platform}, xciDistCli exists=${existsSync(xciDistCli)}`, () => {});
  });
}
