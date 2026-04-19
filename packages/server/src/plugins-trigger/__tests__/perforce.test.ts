import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import perforcePlugin from '../perforce.js';
import type { TriggerConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(opts: {
  headers?: Record<string, string | undefined>;
  body?: unknown;
}): FastifyRequest {
  return {
    headers: opts.headers ?? {},
    body: opts.body ?? {},
  } as unknown as FastifyRequest;
}

const VALID_BODY = {
  change: '12345',
  user: 'alice',
  client: 'alice-workstation',
  root: '/home/alice/depot',
  depot: '//depot/infra/src/app.c',
  delivery_id: 'uuid-delivery-001',
};

// ---------------------------------------------------------------------------
// verify()
// ---------------------------------------------------------------------------

describe('perforcePlugin.verify', () => {
  it('returns header_missing when X-Xci-Token header is absent', () => {
    const req = makeReq({ headers: {}, body: VALID_BODY });
    const result = perforcePlugin.verify(req, null);
    expect(result).toEqual({ ok: false, reason: 'header_missing' });
  });

  it('returns header_missing when X-Xci-Token is empty string', () => {
    const req = makeReq({ headers: { 'x-xci-token': '' }, body: VALID_BODY });
    const result = perforcePlugin.verify(req, null);
    expect(result).toEqual({ ok: false, reason: 'header_missing' });
  });

  it('returns ok:true with deliveryId from body.delivery_id when token present', () => {
    const req = makeReq({
      headers: { 'x-xci-token': 'some-token' },
      body: VALID_BODY,
    });
    const result = perforcePlugin.verify(req, null);
    expect(result).toEqual({ ok: true, deliveryId: 'uuid-delivery-001' });
  });

  it('returns ok:true and auto-generates deliveryId when body.delivery_id absent', () => {
    const bodyWithoutDeliveryId = { ...VALID_BODY };
    // biome-ignore lint/performance/noDelete: intentional for test
    delete (bodyWithoutDeliveryId as Record<string, unknown>).delivery_id;
    const req = makeReq({
      headers: { 'x-xci-token': 'some-token' },
      body: bodyWithoutDeliveryId,
    });
    const result = perforcePlugin.verify(req, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Auto-generated UUID should be a non-empty string (D-24 fallback)
      expect(typeof result.deliveryId).toBe('string');
      expect(result.deliveryId.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

describe('perforcePlugin.parse', () => {
  it('parses valid {change, user, client, root, depot} body', () => {
    const req = makeReq({ body: VALID_BODY });
    const event = perforcePlugin.parse(req);
    expect(event).toMatchObject({
      kind: 'perforce_change',
      change: '12345',
      user: 'alice',
      client: 'alice-workstation',
      root: '/home/alice/depot',
      depot: '//depot/infra/src/app.c',
      deliveryId: 'uuid-delivery-001',
    });
  });

  it('auto-generates deliveryId when body.delivery_id absent', () => {
    const bodyWithoutId = { ...VALID_BODY };
    // biome-ignore lint/performance/noDelete: intentional for test
    delete (bodyWithoutId as Record<string, unknown>).delivery_id;
    const req = makeReq({ body: bodyWithoutId });
    const event = perforcePlugin.parse(req);
    expect(event).not.toBeNull();
    expect(typeof event?.deliveryId).toBe('string');
    expect(event?.deliveryId.length).toBeGreaterThan(0);
  });

  it('throws on missing required field (user)', () => {
    const req = makeReq({
      body: { change: '123', client: 'c', root: '/r', depot: '//d' }, // user missing
    });
    expect(() => perforcePlugin.parse(req)).toThrow();
  });

  it('throws when body is not an object (null)', () => {
    const req = makeReq({ body: null });
    expect(() => perforcePlugin.parse(req)).toThrow();
  });

  it('throws when body is a string (non-JSON body)', () => {
    const req = makeReq({ body: 'not-an-object' });
    expect(() => perforcePlugin.parse(req)).toThrow();
  });

  it('throws when a required field has wrong type (change is number)', () => {
    const req = makeReq({
      body: { change: 12345, user: 'alice', client: 'c', root: '/r', depot: '//d' },
    });
    expect(() => perforcePlugin.parse(req)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// mapToTask()
// ---------------------------------------------------------------------------

const p4Event = {
  kind: 'perforce_change' as const,
  change: '99',
  user: 'alice',
  client: 'alice-ws',
  root: '/home/alice',
  depot: '//depot/infra/src/app.c',
  deliveryId: 'uid-123',
};

describe('perforcePlugin.mapToTask', () => {
  it('matches when depot glob matches event.depot', () => {
    const cfg: TriggerConfig = { plugin: 'perforce', depot: '//depot/infra/*' };
    const results = perforcePlugin.mapToTask(p4Event, [{ taskId: 'task-1', configs: [cfg] }]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      taskId: 'task-1',
      params: {
        'p4.change': '99',
        'p4.user': 'alice',
        'p4.client': 'alice-ws',
        'p4.root': '/home/alice',
        'p4.depot': '//depot/infra/src/app.c',
      },
    });
  });

  it('does not match when depot glob does not match', () => {
    const cfg: TriggerConfig = { plugin: 'perforce', depot: '//depot/other/*' };
    const results = perforcePlugin.mapToTask(p4Event, [{ taskId: 'task-1', configs: [cfg] }]);
    expect(results).toHaveLength(0);
  });

  it('matches when user glob matches event.user', () => {
    const cfg: TriggerConfig = { plugin: 'perforce', user: 'alice' };
    const results = perforcePlugin.mapToTask(p4Event, [{ taskId: 'task-1', configs: [cfg] }]);
    expect(results).toHaveLength(1);
  });

  it('does not match when user glob does not match', () => {
    const cfg: TriggerConfig = { plugin: 'perforce', user: 'bob' };
    const results = perforcePlugin.mapToTask(p4Event, [{ taskId: 'task-1', configs: [cfg] }]);
    expect(results).toHaveLength(0);
  });

  it('matches when client glob matches', () => {
    const cfg: TriggerConfig = { plugin: 'perforce', client: 'alice-*' };
    const results = perforcePlugin.mapToTask(p4Event, [{ taskId: 'task-1', configs: [cfg] }]);
    expect(results).toHaveLength(1);
  });

  it('matches with no filters (all events match)', () => {
    const cfg: TriggerConfig = { plugin: 'perforce' };
    const results = perforcePlugin.mapToTask(p4Event, [{ taskId: 'task-1', configs: [cfg] }]);
    expect(results).toHaveLength(1);
  });

  it('returns empty array for empty candidates', () => {
    expect(perforcePlugin.mapToTask(p4Event, [])).toEqual([]);
  });

  it('does not match GitHub plugin configs', () => {
    const cfg: TriggerConfig = { plugin: 'github', events: ['push'] };
    const results = perforcePlugin.mapToTask(p4Event, [{ taskId: 'task-1', configs: [cfg] }]);
    expect(results).toHaveLength(0);
  });
});
