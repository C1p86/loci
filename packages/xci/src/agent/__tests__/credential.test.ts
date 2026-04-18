import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentCredentialReadError } from '../../errors.js';
import {
  credentialPath,
  loadCredential,
  saveCredential,
  type StoredCredential,
} from '../credential.js';

describe('agent/credential', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'xci-cred-'));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const sample: StoredCredential = {
    version: 1,
    server_url: 'wss://xci.example.com/ws/agent',
    agent_id: 'xci_agt_abc123',
    credential: 'base64url-credential-here',
    registered_at: '2026-04-18T12:00:00.000Z',
  };

  it('loadCredential returns null when file missing', async () => {
    const result = await loadCredential(tmpDir);
    expect(result).toBeNull();
  });

  it('saveCredential + loadCredential round-trip', async () => {
    const path = await saveCredential(sample, tmpDir);
    expect(path).toBe(join(tmpDir, 'agent.json'));
    const loaded = await loadCredential(tmpDir);
    expect(loaded).toEqual(sample);
  });

  it('saveCredential writes mode 0o600 (POSIX only)', async () => {
    if (process.platform === 'win32') return; // Windows ignores mode
    const { stat } = await import('node:fs/promises');
    await saveCredential(sample, tmpDir);
    const s = await stat(join(tmpDir, 'agent.json'));
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('loadCredential throws AgentCredentialReadError on invalid JSON', async () => {
    await saveCredential(sample, tmpDir);
    // corrupt the file
    await writeFile(join(tmpDir, 'agent.json'), 'not-json{');
    await expect(loadCredential(tmpDir)).rejects.toBeInstanceOf(AgentCredentialReadError);
  });

  it('loadCredential throws on version !== 1', async () => {
    const bad = { ...sample, version: 2 };
    await writeFile(join(tmpDir, 'agent.json'), JSON.stringify(bad));
    await expect(loadCredential(tmpDir)).rejects.toBeInstanceOf(AgentCredentialReadError);
  });

  it('credentialPath defaults to env-paths config dir', () => {
    const path = credentialPath();
    expect(path).toMatch(/agent\.json$/);
    // Linux: contains /.config/xci; macOS: /Library/Preferences/xci; Windows: \\xci
    expect(path.includes('xci')).toBe(true);
  });
});
