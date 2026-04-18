// Integration tests for GET /api/orgs/:orgId/agents.
// Covers: Viewer can list, state computed (online/offline/draining), empty list, org isolation.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { makeAdminRepo } from '../../../repos/admin.js';
import { makeAgentsRepo } from '../../../repos/agents.js';
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
    (csrfRes.headers['set-cookie'] as string | string[]).toString().match(/_csrf=([^;]+)/)?.[1] ??
    '';
  return { sid: s.token, csrfToken, csrfCookie };
}

describe('GET /api/orgs/:orgId/agents', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('empty org returns []', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/agents`,
      cookies: { xci_sid: sid },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('Viewer can list agents (read-only)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db);
    const admin = makeAdminRepo(db);

    // Create agent
    await admin.registerNewAgent({ orgId: f.orgA.id, hostname: 'box1', labels: { os: 'linux' } });

    // Create viewer
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
    const { sid } = await makeSession(app, viewerSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/agents`,
      cookies: { xci_sid: sid },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; hostname: string; state: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.hostname).toBe('box1');
  });

  it('state computed: recent last_seen_at → online', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });
    // recordHeartbeat sets last_seen_at = now()
    await makeAgentsRepo(db, f.orgA.id).recordHeartbeat(agentId);
    await makeAgentsRepo(db, f.orgA.id).updateState(agentId, 'online');

    const { sid } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/agents`,
      cookies: { xci_sid: sid },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ state: string }>;
    expect(body[0]?.state).toBe('online');
  });

  it('state computed: draining stored → draining returned', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });
    await makeAgentsRepo(db, f.orgA.id).updateState(agentId, 'draining');

    const { sid } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/agents`,
      cookies: { xci_sid: sid },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ state: string }>;
    expect(body[0]?.state).toBe('draining');
  });

  it('org isolation: orgB user cannot list orgA agents → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid } = await makeSession(app, f.orgB.ownerUser.id, f.orgB.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/agents`,
      cookies: { xci_sid: sid },
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});
