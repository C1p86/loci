import { describe, expect, it } from 'vitest';
import { EmailTransportError } from '../../errors.js';
import { createTransport } from '../transport.js';

function fakeLogger() {
  const calls: Array<{ obj: object; msg: string }> = [];
  return { calls, logger: { info: (obj: object, msg: string) => calls.push({ obj, msg }) } };
}

describe('createTransport (D-29) — log kind', () => {
  it('send() invokes logger.info with {to, subject} metadata only (D-10 — no body/html)', async () => {
    const { calls, logger } = fakeLogger();
    const t = createTransport('log', { logger });
    await t.send({ to: 'u@example.com', subject: 'Hi', html: '<p>body</p>', text: 'body' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.obj).toEqual({ to: 'u@example.com', subject: 'Hi' });
    expect(JSON.stringify(calls[0])).not.toContain('<p>body</p>'); // body never logged
  });
});

describe('createTransport (D-29) — stub kind', () => {
  it('captures messages in order', async () => {
    const { logger } = fakeLogger();
    const t = createTransport('stub', { logger });
    expect(t.captured).toEqual([]);
    await t.send({ to: 'a@x.com', subject: 's1', html: 'h1', text: 't1' });
    await t.send({ to: 'b@x.com', subject: 's2', html: 'h2', text: 't2' });
    expect(t.captured).toHaveLength(2);
    expect(t.captured?.[0]?.to).toBe('a@x.com');
    expect(t.captured?.[1]?.subject).toBe('s2');
  });
});

describe('createTransport (D-29) — smtp kind', () => {
  it('throws EmailTransportError when SMTP_HOST is missing', () => {
    const { logger } = fakeLogger();
    expect(() => createTransport('smtp', { logger, SMTP_FROM: 'x@x.com' })).toThrow(
      EmailTransportError,
    );
  });
  it('throws EmailTransportError when SMTP_FROM is missing', () => {
    const { logger } = fakeLogger();
    expect(() => createTransport('smtp', { logger, SMTP_HOST: 'smtp.example.com' })).toThrow(
      EmailTransportError,
    );
  });
  it('returns a send() function when required fields present (no real SMTP call)', () => {
    const { logger } = fakeLogger();
    const t = createTransport('smtp', {
      logger,
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'x@example.com',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
    });
    expect(typeof t.send).toBe('function');
  });
});
