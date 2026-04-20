import { describe, expect, it } from 'vitest';
import { AgentModeArgsError } from '../../errors.js';
import { normalizeAgentUrl } from '../url.js';

describe('normalizeAgentUrl', () => {
  it.each([
    ['http://localhost:3000', 'ws://localhost:3000/ws/agent'],
    ['https://example.com', 'wss://example.com/ws/agent'],
    ['ws://host:8080', 'ws://host:8080/ws/agent'],
    ['wss://host', 'wss://host/ws/agent'],
    ['localhost:3000', 'ws://localhost:3000/ws/agent'],
    ['ws://localhost:3000/ws/agent', 'ws://localhost:3000/ws/agent'],
    ['http://localhost:3000/', 'ws://localhost:3000/ws/agent'],
    [
      'https://proxy.example.com/custom/agent/path',
      'wss://proxy.example.com/custom/agent/path',
    ],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeAgentUrl(input)).toBe(expected);
  });

  it.each([[''], ['   '], ['file:///etc/passwd'], ['javascript:alert(1)'], ['not a url']])(
    'rejects invalid input %j',
    (bad) => {
      expect(() => normalizeAgentUrl(bad)).toThrow(AgentModeArgsError);
    },
  );

  it('error message includes valid-form hint', () => {
    try {
      normalizeAgentUrl('');
    } catch (e) {
      expect((e as Error).message).toMatch(/ws:\/\/host:3000/);
      expect((e as Error).message).toMatch(/http:\/\/host:3000/);
      expect((e as Error).message).toMatch(/wss:\/\/example\.com/);
      return;
    }
    throw new Error('expected throw');
  });
});
