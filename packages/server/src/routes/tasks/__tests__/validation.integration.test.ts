// Integration tests for D-12 + D-11 validation pipeline on POST/PATCH tasks.
// Covers: parse error with line, cyclic alias rejection, unknown alias with suggestion, AJV size limit.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
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

describe('POST /api/orgs/:orgId/tasks — D-12 validation pipeline', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Malformed YAML → 400 + code XCI_SRV_TASK_VALIDATION + errors[].message', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    // Unclosed YAML sequence — guaranteed parse error
    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'bad-parse', yamlDefinition: 'name: [unclosed' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('XCI_SRV_TASK_VALIDATION');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    const firstErr = body.errors[0] as { message: string };
    expect(typeof firstErr.message).toBe('string');
    expect(firstErr.message.length).toBeGreaterThan(0);
  });

  it('Cyclic alias a→b→a → 400 + errors[].message matches /circular/i', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const cyclicYaml = 'a:\n  steps: [b]\nb:\n  steps: [a]\n';
    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'cyclic', yamlDefinition: cyclicYaml },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('XCI_SRV_TASK_VALIDATION');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    const msg = (body.errors[0] as { message: string }).message;
    expect(msg).toMatch(/circular/i);
  });

  it('Unknown alias ref → 400 + errors[0].suggestion contains Levenshtein suggestion', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    // 'ci' references 'linttt' (typo of 'lint') — expects suggestion 'lint'
    const unknownAliasYaml = 'lint:\n  cmd: biome check\nci:\n  steps: [linttt]\n';
    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'unknown-alias', yamlDefinition: unknownAliasYaml },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('XCI_SRV_TASK_VALIDATION');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    const firstErr = body.errors[0] as { message: string; suggestion?: string };
    expect(firstErr.suggestion).toBeDefined();
    expect(firstErr.suggestion).toContain('lint');
  });

  it('yamlDefinition > 1MB → 400 from AJV schema (pre-validation cut-off)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    // 1MB + 1 byte exceeds AJV maxLength 1048576
    const oversized = 'a'.repeat(1048577);
    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'too-big', yamlDefinition: oversized },
    });
    expect(res.statusCode).toBe(400);
    // AJV validation error — not a TaskValidationError
    expect(res.json().code).toBe('VAL_SCHEMA');
  });

  it('Valid task YAML passes all 4 steps and is saved → 201', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    // Multi-step sequential definition — valid
    const validYaml =
      'lint:\n  cmd: biome check\nbuild:\n  cmd: tsc -b\nci:\n  steps: [lint, build]\n';
    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'ci-pipeline', yamlDefinition: validYaml },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^xci_tsk_/);
  });
});
