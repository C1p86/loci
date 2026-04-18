import { arch, hostname } from 'node:os';

/**
 * Detects default labels (os, arch, node_version, hostname) and merges
 * custom --label key=value entries. Custom entries win over auto-detected.
 * Malformed entries (no `=` or leading `=`) are silently ignored.
 */
export function detectLabels(custom: readonly string[]): Record<string, string> {
  const labels: Record<string, string> = {
    os: process.platform,
    arch: arch(),
    node_version: process.version,
    hostname: hostname(),
  };
  for (const entry of custom) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx <= 0) continue; // ignore malformed (no = or leading =)
    const key = entry.slice(0, eqIdx);
    const value = entry.slice(eqIdx + 1);
    labels[key] = value;
  }
  return labels;
}
