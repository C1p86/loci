// Integration tests for PATCH /api/orgs/:orgId/agents/:agentId.
// Covers: hostname update, state=draining + WS frame, empty body → 400, Viewer → 403.

import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../../app.js';
import { makeAdminRepo } from '../../../repos/admin.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb, TEST_MEK } from '../../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../../test-utils/two-org-fixture.js';

type App = Awaited<ReturnType<typeof buildApp>>;

async function makeSession(app: App, userId: string, orgId: string) {
  const db = getTestDb();
  const repos = makeRepos(db, TEST_MEK);
  const s = await repos.admin.createSession({ userId, activeOrgId: orgId });
  const csrfRes = await app.inject({
    method: 'GET',
    url: '/api/auth/csrf',
    cookies: { xci_sid: s.token },
  });
  const csrfToken = csrfRes.json().csrfToken as string;
  const csrfCookie =
    (csrfRes.headers['set-cookie'] as string | string[]).toString().match(/_csrf=([^;]+)/)?.[1] ??
    '';
  return { sid: s.token, csrfToken, csrfCookie };
}

describe('PATCH /api/orgs/:orgId/agents/:agentId', () => {
  let app: App;
  let port: number;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });
  afterEach(async () => app.close());

  it('Owner updates hostname → 204', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'old',
      labels: {},
    });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { hostname: 'new-hostname' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('state=draining → connected agent WS receives {type:state, state:draining} (D-24)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    // Connect the agent via WS
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(
      JSON.stringify({ type: 'reconnect', credential: credentialPlaintext, running_runs: [] }),
    );
    // Wait for reconnect_ack
    await new Promise<void>((r) => ws.once('message', () => r()));

    // Capture next message (the state frame)
    const nextFrameP = new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
    });

    // Call PATCH to set draining
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { state: 'draining' },
    });
    expect(patchRes.statusCode).toBe(204);

    // Assert the agent received the state frame
    const frame = await nextFrameP;
    expect(frame.type).toBe('state');
    expect(frame.state).toBe('draining');

    ws.terminate();
  });

  it('empty body → 400', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('Viewer → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });
    const repos = makeRepos(db, TEST_MEK);
    const viewerEmail = `viewer-${Date.now()}@example.com`;
    const viewerSignup = await repos.admin.signupTx({
      email: viewerEmail,
      password: 'long-enough-password',
    });
    await repos.admin.markUserEmailVerified(viewerSignup.user.id);
    await repos.admin.addMemberToOrg({
      orgId: f.orgA.id,
      userId: viewerSignup.user.id,
      role: 'viewer',
    });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, viewerSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { hostname: 'blocked' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Missing CSRF → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });
    const repos = makeRepos(db, TEST_MEK);
    const s = await repos.admin.createSession({
      userId: f.orgA.ownerUser.id,
      activeOrgId: f.orgA.id,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}`,
      cookies: { xci_sid: s.token },
      payload: { hostname: 'blocked' },
    });
    expect(res.statusCode).toBe(403);
  });
});
