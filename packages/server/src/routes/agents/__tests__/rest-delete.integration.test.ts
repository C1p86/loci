// Integration tests for DELETE /api/orgs/:orgId/agents/:agentId.
// Covers: Owner hard-deletes, CASCADE removes credentials, Member → 403, missing CSRF → 403.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { makeAdminRepo } from '../../../repos/admin.js';
import { makeAgentCredentialsRepo } from '../../../repos/agent-credentials.js';
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
    (csrfRes.headers['set-cookie'] as string | string[])
      .toString()
      .match(/_csrf=([^;]+)/)?.[1] ?? '';
  return { sid: s.token, csrfToken, csrfCookie };
}

describe('DELETE /api/orgs/:orgId/agents/:agentId', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner deletes agent → 204 + agent row gone', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({ orgId: f.orgA.id, hostname: 'h', labels: {} });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.statusCode).toBe(204);

    // Agent row is gone
    const agent = await makeAgentsRepo(db, f.orgA.id).getById(agentId);
    expect(agent).toBeUndefined();
  });

  it('CASCADE: delete removes agent_credentials rows', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({ orgId: f.orgA.id, hostname: 'h', labels: {} });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    // Credential row should be gone (CASCADE)
    const cred = await makeAgentCredentialsRepo(db, f.orgA.id).findActiveByAgentId(agentId);
    expect(cred).toBeUndefined();
  });

  it('Member → 403 (Owner-only)', async () => {
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
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Missing CSRF → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({ orgId: f.orgA.id, hostname: 'h', labels: {} });
    const repos = makeRepos(db);
    const s = await repos.admin.createSession({ userId: f.orgA.ownerUser.id, activeOrgId: f.orgA.id });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}`,
      cookies: { xci_sid: s.token },
    });
    expect(res.statusCode).toBe(403);
  });

  it('org isolation: orgB user cannot delete orgA agents → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({ orgId: f.orgA.id, hostname: 'h', labels: {} });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgB.ownerUser.id, f.orgB.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/agents/${agentId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});
