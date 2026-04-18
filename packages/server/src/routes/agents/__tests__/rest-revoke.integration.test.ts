// Integration tests for POST /api/orgs/:orgId/agents/:agentId/revoke.
// Covers: ATOK-04 — revoke sets revoked_at + force-closes connected WS with 4001.

import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../../app.js';
import { makeAdminRepo } from '../../../repos/admin.js';
import { makeAgentCredentialsRepo } from '../../../repos/agent-credentials.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb } from '../../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../../test-utils/two-org-fixture.js';

type App = Awaited<ReturnType<typeof buildApp>>;

async function makeSession(app: App, userId: string, orgId: string) {
  const db = getTestDb();
  const repos = makeRepos(db);
  const s = await repos.admin.createSession({ userId, activeOrgId: orgId });
  const csrfRes = await app.inject({
    method: 'GET',
    url: '/api/auth/csrf',
    cookies: { xci_sid: s.token },
  });
  const csrfToken = csrfRes.json().csrfToken as string;
  const csrfCookie =
    (csrfRes.headers['set-cookie'] as string | string[])
      .toString()
      .match(/_csrf=([^;]+)/)?.[1] ?? '';
  return { sid: s.token, csrfToken, csrfCookie };
}

describe('POST /api/orgs/:orgId/agents/:agentId/revoke', () => {
  let app: App;
  let port: number;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });
  afterEach(async () => app.close());

  it('revoke while WS connected → WS closes 4001 (ATOK-04)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    // Connect agent via WS
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(
      JSON.stringify({ type: 'reconnect', credential: credentialPlaintext, running_runs: [] }),
    );
    await new Promise<void>((r) => ws.once('message', () => r())); // reconnect_ack

    // Capture WS close event
    const closeP = new Promise<{ code: number }>((resolve) => {
      ws.once('close', (code) => resolve({ code }));
    });

    // Call revoke
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}/revoke`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.statusCode).toBe(204);

    const { code } = await closeP;
    expect(code).toBe(4001);
  });

  it('revoked credential cannot reconnect → 4001', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    // Revoke via REST
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}/revoke`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    // Verify credential is revoked in DB
    const cred = await makeAgentCredentialsRepo(db, f.orgA.id).findActiveByAgentId(agentId);
    expect(cred).toBeUndefined();

    // Try to reconnect — should fail
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(
      JSON.stringify({ type: 'reconnect', credential: credentialPlaintext, running_runs: [] }),
    );
    const closeEvent = await new Promise<{ code: number }>((resolve) => {
      ws.once('close', (code) => resolve({ code }));
    });
    expect(closeEvent.code).toBe(4001);
  });

  it('Member can revoke → 204', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({ orgId: f.orgA.id, hostname: 'h', labels: {} });
    const repos = makeRepos(db);
    const memberEmail = `member-${Date.now()}@example.com`;
    const memberSignup = await repos.admin.signupTx({ email: memberEmail, password: 'long-enough-password' });
    await repos.admin.markUserEmailVerified(memberSignup.user.id);
    await repos.admin.addMemberToOrg({ orgId: f.orgA.id, userId: memberSignup.user.id, role: 'member' });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, memberSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}/revoke`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.statusCode).toBe(204);
  });

  it('Viewer → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({ orgId: f.orgA.id, hostname: 'h', labels: {} });
    const repos = makeRepos(db);
    const viewerEmail = `viewer-${Date.now()}@example.com`;
    const viewerSignup = await repos.admin.signupTx({ email: viewerEmail, password: 'long-enough-password' });
    await repos.admin.markUserEmailVerified(viewerSignup.user.id);
    await repos.admin.addMemberToOrg({ orgId: f.orgA.id, userId: viewerSignup.user.id, role: 'viewer' });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, viewerSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}/revoke`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.statusCode).toBe(403);
  });
});
