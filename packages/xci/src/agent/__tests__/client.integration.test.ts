import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentClient } from '../client.js';
import { createTestServer, type TestServer } from './test-server.js';

describe('AgentClient integration (mock server)', () => {
  let server: TestServer;
  let tmpDir: string;

  beforeEach(async () => {
    server = await createTestServer();
    tmpDir = await mkdtemp(join(tmpdir(), 'xci-agent-test-'));
  });
  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('sends register frame on open', async () => {
    const framesReceived: string[] = [];
    server.onFrame((_sock, raw) => framesReceived.push(raw));

    await new Promise<void>((resolve) => {
      const client = new AgentClient({
        url: `ws://127.0.0.1:${server.port}/`,
        onOpen: () => {
          client.send({ type: 'register', token: 'test-token', labels: { os: 'linux' } });
          resolve();
        },
        onMessage: () => {},
        onClose: () => {},
      });
    });

    // Wait for server to receive the frame
    await new Promise((r) => setTimeout(r, 200));
    expect(framesReceived.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(framesReceived[0]!);
    expect(parsed.type).toBe('register');
    expect(parsed.token).toBe('test-token');
  });

  it('parses server messages as AgentFrame', async () => {
    const messages: unknown[] = [];

    server.onFrame((sock) => {
      // Reply with register_ack when agent connects
      sock.send(
        JSON.stringify({
          type: 'register_ack',
          agent_id: 'xci_agt_test',
          credential: 'cred-plain',
        }),
      );
    });

    const client = new AgentClient({
      url: `ws://127.0.0.1:${server.port}/`,
      onOpen: () => {
        client.send({ type: 'register', token: 't', labels: {} });
      },
      onMessage: (frame) => {
        messages.push(frame);
      },
      onClose: () => {},
    });

    await new Promise((r) => setTimeout(r, 500));
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect((messages[0] as { type: string }).type).toBe('register_ack');
    client.close();
  });
});
