import { describe, expect, it } from 'vitest';
import { buildAgentWsUrl } from '../agentUrl.js';

describe('buildAgentWsUrl', () => {
  it.each([
    ['http://localhost:5173', 'ws://localhost:5173/ws/agent'],
    ['https://app.example.com', 'wss://app.example.com/ws/agent'],
    ['http://localhost:3000/ws/agent', 'ws://localhost:3000/ws/agent'],
    ['http://192.168.1.10:8000', 'ws://192.168.1.10:8000/ws/agent'],
    ['http://localhost:3000/custom', 'ws://localhost:3000/custom'],
  ])('%s → %s', (input, expected) => {
    expect(buildAgentWsUrl(input)).toBe(expected);
  });

  it('returns input unchanged on unparseable string', () => {
    expect(buildAgentWsUrl('not a url')).toBe('not a url');
  });
});
