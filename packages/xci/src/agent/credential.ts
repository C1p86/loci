import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import envPaths from 'env-paths';
import { AgentCredentialReadError, AgentCredentialWriteError } from '../errors.js';

export interface StoredCredential {
  version: 1;
  server_url: string;
  agent_id: string;
  credential: string;
  registered_at: string;
}

/**
 * Returns the full path to agent.json.
 * configDir overrides the default env-paths location (XDG-compliant per D-07).
 *
 * Paths by OS (via env-paths 'xci', { suffix: '' }):
 *   Linux:   ~/.config/xci/agent.json
 *   macOS:   ~/Library/Preferences/xci/agent.json   (NOT ~/.config — RESEARCH Pitfall 5)
 *   Windows: %APPDATA%\xci\Config\agent.json
 */
export function credentialPath(configDir?: string): string {
  const dir = configDir ?? envPaths('xci', { suffix: '' }).config;
  return join(dir, 'agent.json');
}

/**
 * Loads the credential file. Returns null if missing.
 * Throws AgentCredentialReadError if the file is invalid JSON or has version !== 1.
 */
export async function loadCredential(configDir?: string): Promise<StoredCredential | null> {
  const path = credentialPath(configDir);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new AgentCredentialReadError(path, err);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AgentCredentialReadError(path, err);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new AgentCredentialReadError(path, new Error('not an object'));
  }
  const p = parsed as Record<string, unknown>;
  if (p['version'] !== 1) {
    throw new AgentCredentialReadError(
      path,
      new Error(`unsupported version: ${String(p['version'])}`),
    );
  }
  for (const key of ['server_url', 'agent_id', 'credential', 'registered_at'] as const) {
    if (typeof p[key] !== 'string') {
      throw new AgentCredentialReadError(path, new Error(`missing/invalid field: ${key}`));
    }
  }
  return {
    version: 1,
    server_url: p['server_url'] as string,
    agent_id: p['agent_id'] as string,
    credential: p['credential'] as string,
    registered_at: p['registered_at'] as string,
  };
}

/**
 * Saves the credential to disk with mode 0600 (POSIX).
 * Creates the directory recursively if it doesn't exist.
 * Returns the resolved file path.
 * Throws AgentCredentialWriteError if write fails.
 */
export async function saveCredential(cred: StoredCredential, configDir?: string): Promise<string> {
  const path = credentialPath(configDir);
  const dir = join(path, '..');
  try {
    await mkdir(dir, { recursive: true });
    // mode 0o600 on POSIX; Windows silently ignores (ACL default already restricts %APPDATA%)
    await writeFile(path, JSON.stringify(cred, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    throw new AgentCredentialWriteError(path, err);
  }
  return path;
}
