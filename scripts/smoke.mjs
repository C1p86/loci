#!/usr/bin/env node
// scripts/smoke.mjs
// PKG-08 — end-to-end smoke against a running xci/server image.
// Usage: node scripts/smoke.mjs [baseUrl] [mailhogBaseUrl]
//   defaults: baseUrl=http://localhost:3000, mailhogBaseUrl=http://localhost:8025
//
// Environment:
//   SMOKE_BASE_URL     — overrides baseUrl argument (default http://localhost:3000)
//   SMOKE_MAILHOG_URL  — overrides mailhogBaseUrl argument (default http://localhost:8025)
//
// Exit code 0: all steps green
// Exit code 1: any failure (error message printed to stderr)

import { randomBytes } from 'node:crypto';

const BASE =
  process.env.SMOKE_BASE_URL ??
  process.argv[2] ??
  'http://localhost:3000';

const MAILHOG =
  process.env.SMOKE_MAILHOG_URL ??
  process.argv[3] ??
  'http://localhost:8025';

const STEP = (n, msg) => console.log(`[smoke:${n}] ${msg}`);
const FAIL = (msg) => {
  console.error(`[smoke:FAIL] ${msg}`);
  process.exit(1);
};

// --------------------------------------------------------------------------
// Minimal cookie jar — tracks xci_sid (session) and _csrf cookies.
// Uses getSetCookie() if available (Node 22+ fetch); falls back to
// splitting the Set-Cookie header on commas for older Node/shims.
// --------------------------------------------------------------------------
let sessionCookie = '';
let csrfCookie = '';

const cookieHeader = () =>
  [sessionCookie, csrfCookie].filter(Boolean).join('; ');

function captureCookies(res) {
  const all =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie')
      ? res.headers.get('set-cookie').split(/,(?=\s*[\w-]+=)/)
      : [];
  for (const raw of all) {
    const [kv] = raw.split(';');
    const trimmed = kv.trim();
    if (trimmed.startsWith('xci_sid=')) sessionCookie = trimmed;
    if (trimmed.startsWith('_csrf=')) csrfCookie = trimmed;
  }
}

// --------------------------------------------------------------------------
// JSON helper — attaches cookies + optional CSRF header.
// Returns { status, payload }.
// --------------------------------------------------------------------------
async function api(path, { method = 'GET', body, csrf } = {}) {
  const headers = { 'content-type': 'application/json' };
  const ch = cookieHeader();
  if (ch) headers.cookie = ch;
  if (csrf) headers['x-csrf-token'] = csrf;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  captureCookies(res);

  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  return { status: res.status, payload };
}

// --------------------------------------------------------------------------
// Step 1 — Healthcheck: poll until 200 (up to 60s to account for boot lag)
// --------------------------------------------------------------------------
STEP(1, `healthz → ${BASE}/api/healthz`);
{
  let ok = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE}/api/healthz`);
      if (res.status === 200) {
        const body = await res.json();
        if (body.ok === true) {
          ok = true;
          break;
        }
        FAIL(`healthz body unexpected: ${JSON.stringify(body)}`);
      }
    } catch {
      // server not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ok) FAIL('healthz never returned ok:true after 60s');
}

// --------------------------------------------------------------------------
// Step 2 — Signup
// --------------------------------------------------------------------------
const email = `smoke-${randomBytes(6).toString('hex')}@example.com`;
const password = `SmokePass-${randomBytes(8).toString('base64url')}!`;

STEP(2, `signup → ${email}`);
{
  const { status, payload } = await api('/api/auth/signup', {
    method: 'POST',
    body: { email, password, name: 'Smoke Tester' },
  });
  if (status !== 201)
    FAIL(`signup returned ${status}: ${JSON.stringify(payload)}`);
}

// --------------------------------------------------------------------------
// Step 3 — Poll MailHog for verification token
// --------------------------------------------------------------------------
STEP(3, `poll mailhog for verify token → ${MAILHOG}/api/v2/messages`);
let verifyToken = null;
for (let attempt = 0; attempt < 30 && !verifyToken; attempt++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const mh = await fetch(`${MAILHOG}/api/v2/messages`);
    if (!mh.ok) continue;
    const mj = await mh.json();
    for (const msg of mj.items ?? []) {
      const toMatch = (msg.To ?? []).some(
        (t) =>
          `${t.Mailbox}@${t.Domain}`.toLowerCase() === email.toLowerCase(),
      );
      if (!toMatch) continue;
      const bodyText = msg.Content?.Body ?? '';
      const m = bodyText.match(/token=([A-Za-z0-9_\-]+)/);
      if (m) {
        verifyToken = m[1];
        break;
      }
    }
  } catch {
    // mailhog not ready — retry
  }
}
if (!verifyToken) FAIL('never received verification email in 30s');

// --------------------------------------------------------------------------
// Step 4 — Verify email
// --------------------------------------------------------------------------
STEP(4, 'verify-email');
{
  const { status, payload } = await api('/api/auth/verify-email', {
    method: 'POST',
    body: { token: verifyToken },
  });
  if (status !== 200)
    FAIL(`verify-email returned ${status}: ${JSON.stringify(payload)}`);
}

// --------------------------------------------------------------------------
// Step 5 — Login
// --------------------------------------------------------------------------
STEP(5, 'login');
{
  const { status, payload } = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (status !== 200)
    FAIL(`login returned ${status}: ${JSON.stringify(payload)}`);
}

// --------------------------------------------------------------------------
// Step 6 — GET /api/auth/me → extract orgId
// --------------------------------------------------------------------------
STEP(6, 'auth/me');
const me = await api('/api/auth/me');
if (me.status !== 200) FAIL(`auth/me returned ${me.status}`);

const orgId =
  me.payload.activeOrgId ??
  me.payload.orgId ??
  me.payload.org?.id ??
  me.payload.org_id;
if (!orgId)
  FAIL(`no orgId found in /api/auth/me: ${JSON.stringify(me.payload)}`);

// --------------------------------------------------------------------------
// Step 7 — Fetch CSRF token
// --------------------------------------------------------------------------
STEP(7, 'csrf');
const csrfRes = await api('/api/auth/csrf');
if (csrfRes.status !== 200)
  FAIL(`csrf returned ${csrfRes.status}`);

const csrf = csrfRes.payload.token;
if (!csrf) FAIL('no csrf token in response');

// --------------------------------------------------------------------------
// Step 8 — Create registration token
// --------------------------------------------------------------------------
STEP(8, `registration token → /api/orgs/${orgId}/agents/registration-tokens`);
{
  const { status, payload } = await api(
    `/api/orgs/${orgId}/agents/registration-tokens`,
    { method: 'POST', body: {}, csrf },
  );
  if (status !== 201)
    FAIL(`registration-token returned ${status}: ${JSON.stringify(payload)}`);
  if (!payload.token) FAIL('registration-token response missing .token field');
}

// --------------------------------------------------------------------------
// Step 9 — Create task
// --------------------------------------------------------------------------
STEP(9, `create task → /api/orgs/${orgId}/tasks`);
let taskId;
{
  const { status, payload } = await api(`/api/orgs/${orgId}/tasks`, {
    method: 'POST',
    csrf,
    body: {
      name: 'Smoke Task',
      slug: 'smoke-task',
      yaml_definition: 'default:\n  echo: ["echo", "smoke"]\n',
      label_requirements: [],
    },
  });
  if (status !== 201)
    FAIL(`task create returned ${status}: ${JSON.stringify(payload)}`);
  taskId = payload.id ?? payload.task_id;
  if (!taskId) FAIL('task create response missing id');
}

// --------------------------------------------------------------------------
// Step 10 — Trigger run
// --------------------------------------------------------------------------
STEP(10, `trigger run → /api/orgs/${orgId}/tasks/${taskId}/runs`);
let runId;
{
  const { status, payload } = await api(
    `/api/orgs/${orgId}/tasks/${taskId}/runs`,
    { method: 'POST', csrf, body: {} },
  );
  if (status !== 202)
    FAIL(`trigger run returned ${status}: ${JSON.stringify(payload)}`);
  runId = payload.id ?? payload.run_id;
  if (!runId) FAIL('trigger run response missing id');
}

// --------------------------------------------------------------------------
// Step 11 — Poll run state (expects queued/dispatched/running; no agent connected)
// --------------------------------------------------------------------------
STEP(11, `run state → /api/orgs/${orgId}/runs/${runId}`);
{
  const { status, payload } = await api(`/api/orgs/${orgId}/runs/${runId}`);
  if (status !== 200) FAIL(`run get returned ${status}`);
  const validStates = ['queued', 'dispatched', 'running'];
  if (!validStates.includes(payload.status))
    FAIL(
      `run status is "${payload.status}" — expected one of: ${validStates.join(', ')}`,
    );
}

// --------------------------------------------------------------------------
// Step 12 — Usage endpoint
// --------------------------------------------------------------------------
STEP(12, `usage → /api/orgs/${orgId}/usage`);
{
  const { status, payload } = await api(`/api/orgs/${orgId}/usage`);
  if (status !== 200) FAIL(`usage returned ${status}`);
  if (typeof payload.agents?.limit !== 'number')
    FAIL(`usage.agents.limit missing or non-numeric: ${JSON.stringify(payload)}`);
}

// --------------------------------------------------------------------------
// Step 13 — SPA index (PKG-05 — @fastify/static serving web bundle)
// --------------------------------------------------------------------------
STEP(13, `SPA index → ${BASE}/`);
{
  const res = await fetch(`${BASE}/`);
  if (res.status !== 200) FAIL(`SPA index returned ${res.status}`);
  const body = await res.text();
  if (!body.toLowerCase().includes('<!doctype'))
    FAIL('SPA index does not contain <!doctype — not a valid HTML page');
}

console.log('[smoke:PASS] all 13 steps green');
