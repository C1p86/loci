import { describe, expect, it } from 'vitest';
import { detectLabels } from '../labels.js';

describe('agent/labels', () => {
  it('auto-detects os/arch/node_version/hostname', () => {
    const labels = detectLabels([]);
    expect(labels.os).toBe(process.platform);
    expect(typeof labels.arch).toBe('string');
    expect(labels.node_version).toBe(process.version);
    expect(typeof labels.hostname).toBe('string');
    expect(labels.hostname.length).toBeGreaterThan(0);
  });

  it('merges custom key=value pairs', () => {
    const labels = detectLabels(['env=prod', 'tier=primary']);
    expect(labels.env).toBe('prod');
    expect(labels.tier).toBe('primary');
    expect(labels.os).toBe(process.platform);
  });

  it('ignores malformed entries (no equals)', () => {
    const labels = detectLabels(['malformed', 'also-bad']);
    expect(labels).not.toHaveProperty('malformed');
    expect(labels).not.toHaveProperty('also-bad');
  });

  it('handles value with equals signs', () => {
    const labels = detectLabels(['key=value=with=equals']);
    expect(labels.key).toBe('value=with=equals');
  });

  it('custom labels override auto-detected (intentional — user knows best)', () => {
    const labels = detectLabels(['hostname=custom-host']);
    expect(labels.hostname).toBe('custom-host');
  });
});
