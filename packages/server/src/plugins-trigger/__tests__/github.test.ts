import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import githubPlugin from '../github.js';
import type { GitHubEvent, TriggerConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers — build minimal FastifyRequest-like mocks
// ---------------------------------------------------------------------------

function makeReq(opts: {
  headers?: Record<string, string | undefined>;
  body?: unknown;
  rawBody?: Buffer;
}): FastifyRequest {
  return {
    headers: opts.headers ?? {},
    body: opts.body ?? {},
    ...(opts.rawBody !== undefined ? { rawBody: opts.rawBody } : {}),
  } as unknown as FastifyRequest;
}

function computeHmac(secret: Buffer, body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

const SECRET = Buffer.from('webhook-secret-value', 'utf8');
const BODY_BUF = Buffer.from('{"ref":"refs/heads/main"}', 'utf8');
const VALID_SIG = `sha256=${computeHmac(SECRET, BODY_BUF)}`;
const DELIVERY_ID = 'abc-delivery-123';

// ---------------------------------------------------------------------------
// verify()
// ---------------------------------------------------------------------------

describe('githubPlugin.verify', () => {
  it('returns signature_missing when X-Hub-Signature-256 header is absent', () => {
    const req = makeReq({
      headers: { 'x-github-delivery': DELIVERY_ID },
      rawBody: BODY_BUF,
    });
    const result = githubPlugin.verify(req, SECRET);
    expect(result).toEqual({ ok: false, reason: 'signature_missing' });
  });

  it('returns signature_missing when header has no sha256= prefix', () => {
    const req = makeReq({
      headers: {
        'x-github-delivery': DELIVERY_ID,
        'x-hub-signature-256': 'abc123',
      },
      rawBody: BODY_BUF,
    });
    const result = githubPlugin.verify(req, SECRET);
    expect(result).toEqual({ ok: false, reason: 'signature_missing' });
  });

  it('returns header_missing when X-GitHub-Delivery is absent', () => {
    const req = makeReq({
      headers: { 'x-hub-signature-256': VALID_SIG },
      rawBody: BODY_BUF,
    });
    const result = githubPlugin.verify(req, SECRET);
    expect(result).toEqual({ ok: false, reason: 'header_missing' });
  });

  it('returns header_missing when pluginSecret is null', () => {
    const req = makeReq({
      headers: {
        'x-github-delivery': DELIVERY_ID,
        'x-hub-signature-256': VALID_SIG,
      },
      rawBody: BODY_BUF,
    });
    const result = githubPlugin.verify(req, null);
    expect(result).toEqual({ ok: false, reason: 'header_missing' });
  });

  it('returns signature_mismatch when HMAC does not match', () => {
    const req = makeReq({
      headers: {
        'x-github-delivery': DELIVERY_ID,
        'x-hub-signature-256': 'sha256=deadbeefdeadbeef',
      },
      rawBody: BODY_BUF,
    });
    const result = githubPlugin.verify(req, SECRET);
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('returns ok:true with deliveryId when HMAC matches', () => {
    const req = makeReq({
      headers: {
        'x-github-delivery': DELIVERY_ID,
        'x-hub-signature-256': VALID_SIG,
      },
      rawBody: BODY_BUF,
    });
    const result = githubPlugin.verify(req, SECRET);
    expect(result).toEqual({ ok: true, deliveryId: DELIVERY_ID });
  });

  it('returns signature_mismatch (not throws) when rawBody is missing', () => {
    const req = makeReq({
      headers: {
        'x-github-delivery': DELIVERY_ID,
        'x-hub-signature-256': VALID_SIG,
      },
      // rawBody intentionally omitted
    });
    const result = githubPlugin.verify(req, SECRET);
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });
});

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

const pushBody = {
  ref: 'refs/heads/main',
  repository: { full_name: 'acme/infra' },
  head_commit: { id: 'abc123sha', message: 'fix: something' },
  pusher: { name: 'alice' },
};

const prBody = {
  action: 'opened',
  pull_request: {
    number: 42,
    head: { ref: 'feature/my-branch' },
    base: { ref: 'main' },
    title: 'My PR title',
  },
  repository: { full_name: 'acme/infra' },
};

describe('githubPlugin.parse', () => {
  it('parses push event correctly', () => {
    const req = makeReq({
      headers: { 'x-github-event': 'push' },
      body: pushBody,
    });
    const event = githubPlugin.parse(req);
    expect(event).toEqual({
      kind: 'push',
      ref: 'refs/heads/main',
      repository: 'acme/infra',
      sha: 'abc123sha',
      pusher: 'alice',
      message: 'fix: something',
    });
  });

  it('parses pull_request event correctly', () => {
    const req = makeReq({
      headers: { 'x-github-event': 'pull_request' },
      body: prBody,
    });
    const event = githubPlugin.parse(req);
    expect(event).toEqual({
      kind: 'pull_request',
      action: 'opened',
      repository: 'acme/infra',
      number: 42,
      headRef: 'feature/my-branch',
      baseRef: 'main',
      title: 'My PR title',
    });
  });

  it('returns null for unsupported event (issues)', () => {
    const req = makeReq({
      headers: { 'x-github-event': 'issues' },
      body: { action: 'opened' },
    });
    expect(githubPlugin.parse(req)).toBeNull();
  });

  it('returns null for unsupported event (workflow_run)', () => {
    const req = makeReq({
      headers: { 'x-github-event': 'workflow_run' },
      body: {},
    });
    expect(githubPlugin.parse(req)).toBeNull();
  });

  it('returns null for ping event', () => {
    const req = makeReq({
      headers: { 'x-github-event': 'ping' },
      body: { zen: 'Keep it logically awesome.' },
    });
    expect(githubPlugin.parse(req)).toBeNull();
  });

  it('throws on malformed push body (missing ref)', () => {
    const req = makeReq({
      headers: { 'x-github-event': 'push' },
      body: { repository: { full_name: 'acme/infra' } }, // ref missing
    });
    expect(() => githubPlugin.parse(req)).toThrow();
  });

  it('throws on malformed pull_request body (missing action)', () => {
    const req = makeReq({
      headers: { 'x-github-event': 'pull_request' },
      body: { pull_request: { head: { ref: 'feat/x' }, base: { ref: 'main' }, number: 1 } },
    });
    expect(() => githubPlugin.parse(req)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// mapToTask()
// ---------------------------------------------------------------------------

const pushEvent: GitHubEvent = {
  kind: 'push',
  ref: 'refs/heads/main',
  repository: 'acme/infra',
  sha: 'deadbeef',
  pusher: 'alice',
  message: 'chore: update deps',
};

const prEvent: GitHubEvent = {
  kind: 'pull_request',
  action: 'synchronize',
  repository: 'acme/infra',
  number: 7,
  headRef: 'feature/my-branch',
  baseRef: 'main',
  title: 'Add feature',
};

const matchingPushConfig: TriggerConfig = {
  plugin: 'github',
  events: ['push'],
  repository: 'acme/*',
  branch: 'main',
};

const matchingPrConfig: TriggerConfig = {
  plugin: 'github',
  events: ['pull_request'],
  repository: 'acme/*',
  actions: ['opened', 'synchronize'],
};

describe('githubPlugin.mapToTask', () => {
  it('matches push event with correct glob config', () => {
    const candidates = [{ taskId: 'task-1', configs: [matchingPushConfig] }];
    const results = githubPlugin.mapToTask(pushEvent, candidates);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      taskId: 'task-1',
      params: {
        'git.ref': 'refs/heads/main',
        'git.sha': 'deadbeef',
        'git.repository': 'acme/infra',
        'git.pusher': 'alice',
        'git.message': 'chore: update deps',
      },
    });
  });

  it('does not match push event when branch glob does not match', () => {
    const cfg: TriggerConfig = { plugin: 'github', events: ['push'], branch: 'release/*' };
    const results = githubPlugin.mapToTask(pushEvent, [{ taskId: 'task-1', configs: [cfg] }]);
    expect(results).toHaveLength(0);
  });

  it('does not match push event when repository glob does not match', () => {
    const cfg: TriggerConfig = { plugin: 'github', events: ['push'], repository: 'other/*' };
    const results = githubPlugin.mapToTask(pushEvent, [{ taskId: 'task-1', configs: [cfg] }]);
    expect(results).toHaveLength(0);
  });

  it('matches PR event with actions filter', () => {
    const candidates = [{ taskId: 'task-2', configs: [matchingPrConfig] }];
    const results = githubPlugin.mapToTask(prEvent, candidates);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      taskId: 'task-2',
      params: {
        'pr.number': '7',
        'pr.action': 'synchronize',
        'pr.head_ref': 'feature/my-branch',
        'pr.base_ref': 'main',
        'pr.title': 'Add feature',
        'git.repository': 'acme/infra',
      },
    });
  });

  it('does not match PR when action is not in actions filter', () => {
    const cfg: TriggerConfig = {
      plugin: 'github',
      events: ['pull_request'],
      actions: ['opened'],
    };
    // prEvent.action is 'synchronize' — not in ['opened']
    const results = githubPlugin.mapToTask(prEvent, [{ taskId: 'task-1', configs: [cfg] }]);
    expect(results).toHaveLength(0);
  });

  it('returns all matches when event matches multiple tasks', () => {
    const candidates = [
      { taskId: 'task-a', configs: [matchingPushConfig] },
      { taskId: 'task-b', configs: [matchingPushConfig] },
    ];
    const results = githubPlugin.mapToTask(pushEvent, candidates);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.taskId)).toEqual(['task-a', 'task-b']);
  });

  it('returns empty array when candidates is empty', () => {
    expect(githubPlugin.mapToTask(pushEvent, [])).toEqual([]);
  });

  it('branch is empty string for tag push (refs/tags/v1)', () => {
    const tagPushEvent: GitHubEvent = {
      kind: 'push',
      ref: 'refs/tags/v1.0.0',
      repository: 'acme/infra',
      sha: 'tagsha',
      pusher: 'alice',
      message: 'tag v1.0.0',
    };
    // Config with branch='main' should NOT match a tag push
    const results = githubPlugin.mapToTask(tagPushEvent, [
      { taskId: 'task-1', configs: [matchingPushConfig] },
    ]);
    expect(results).toHaveLength(0);
  });

  it('matches tag push when config has no branch filter', () => {
    const cfg: TriggerConfig = { plugin: 'github', events: ['push'], repository: 'acme/*' };
    const tagPushEvent: GitHubEvent = {
      kind: 'push',
      ref: 'refs/tags/v1.0.0',
      repository: 'acme/infra',
      sha: 'tagsha',
      pusher: 'alice',
      message: 'tag',
    };
    const results = githubPlugin.mapToTask(tagPushEvent, [{ taskId: 'task-1', configs: [cfg] }]);
    expect(results).toHaveLength(1);
  });
});
