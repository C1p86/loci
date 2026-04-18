// Cold-start smoke test (BC-04, D-29).
// Guards against the agent module being bundled into cli.mjs (Pitfall 6).
// Note: dist/cli.mjs must be built before this test runs.
//   CI: pnpm turbo run build always precedes test.
//   Locally: pnpm --filter xci build

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Resolve dist/cli.mjs relative to this test file's location:
// src/__tests__/ → src/ → packages/xci/ → dist/cli.mjs
const distCli = join(import.meta.dirname, '..', '..', 'dist', 'cli.mjs');
const distAgent = join(import.meta.dirname, '..', '..', 'dist', 'agent.mjs');

describe('cold-start smoke (BC-04, D-29)', () => {
  it('dist/cli.mjs exists after build', () => {
    if (!existsSync(distCli)) {
      throw new Error(`dist/cli.mjs not found at ${distCli}. Run: pnpm --filter xci build`);
    }
    expect(existsSync(distCli)).toBe(true);
  });

  it('dist/cli.mjs does NOT contain ReconnectingWebSocket strings (BC-03 / Pitfall 6)', () => {
    if (!existsSync(distCli)) return; // skip if build missing
    const content = readFileSync(distCli, 'utf8');
    expect(content).not.toContain('ReconnectingWebSocket');
    // Verify agent code is not statically bundled into the CLI entry
    expect(content).not.toMatch(/from\s+['"]ws['"]/);
    expect(content).not.toMatch(/require\s*\(\s*['"]ws['"]\s*\)/);
  });

  it('dist/cli.mjs dynamic import points to ./agent/index.js at runtime (not inlined)', () => {
    if (!existsSync(distCli)) return; // skip if build missing
    const content = readFileSync(distCli, 'utf8');
    // The dynamic import must remain as a true runtime import, not an inlined IIFE
    expect(content).toMatch(/import\(['"]\.\/agent\/index\.js['"]\)/);
    // Must NOT contain the init_agent IIFE pattern (tsup's inline shim)
    expect(content).not.toContain('init_agent()');
  });

  it('xci --version cold start completes under 500ms (generous; hyperfine CI gate enforces 300ms)', () => {
    if (!existsSync(distCli)) return; // skip if build missing
    const start = Date.now();
    const result = spawnSync(process.execPath, [distCli, '--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const elapsed = Date.now() - start;
    expect(result.status).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0); // version string printed
    // Generous bound accounting for test-runner overhead.
    // Hyperfine CI gate (D-17 / D-29) is the strict 300ms check.
    expect(elapsed).toBeLessThan(500);
  });

  it('dist/agent.mjs exists (separate entry — agent code isolated from cli.mjs)', () => {
    expect(existsSync(distAgent)).toBe(true);
  });

  it('dist/agent.mjs contains ReconnectingWebSocket (agent module loaded only on --agent path)', () => {
    if (!existsSync(distAgent)) return; // skip if build missing
    const content = readFileSync(distAgent, 'utf8');
    expect(content).toContain('ReconnectingWebSocket');
  });
});
