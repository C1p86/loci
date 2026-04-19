import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import githubPlugin from '../github.js';
import perforcePlugin from '../perforce.js';
import { getPlugin, pluginRegistry } from '../index.js';
import type { TriggerPlugin } from '../types.js';

// ---------------------------------------------------------------------------
// Contract test harness (D-32)
// ---------------------------------------------------------------------------

function makeEmptyReq(): FastifyRequest {
  return { headers: {}, body: null } as unknown as FastifyRequest;
}

function makeGitHubMalformedReq(): FastifyRequest {
  return {
    headers: { 'x-github-event': 'push' },
    // body is missing required 'ref' field — parse() should throw
    body: { repository: { full_name: 'x/y' } },
  } as unknown as FastifyRequest;
}

function makePerforceReq(): FastifyRequest {
  return {
    headers: { 'x-xci-token': 'test-token' },
    body: {
      change: '1',
      user: 'u',
      client: 'c',
      root: '/r',
      depot: '//d',
      delivery_id: 'del-001',
    },
  } as unknown as FastifyRequest;
}

/**
 * Generic contract test harness (D-32).
 * Verifies structural + behavioral contract of every TriggerPlugin.
 */
// biome-ignore lint/suspicious/noExplicitAny: event type is plugin-specific
function contractTest(plugin: TriggerPlugin<any>): void {
  describe(`contractTest(${plugin.name})`, () => {
    it('has a non-empty name string', () => {
      expect(typeof plugin.name).toBe('string');
      expect(plugin.name.length).toBeGreaterThan(0);
    });

    it('exposes verify as a function', () => {
      expect(typeof plugin.verify).toBe('function');
    });

    it('exposes parse as a function', () => {
      expect(typeof plugin.parse).toBe('function');
    });

    it('exposes mapToTask as a function', () => {
      expect(typeof plugin.mapToTask).toBe('function');
    });

    it('verify(emptyReq, null) returns a VerifyResult shaped object', () => {
      const result = plugin.verify(makeEmptyReq(), null);
      expect(result).toHaveProperty('ok');
      expect(typeof result.ok).toBe('boolean');
      if (result.ok) {
        expect(typeof result.deliveryId).toBe('string');
      } else {
        expect(typeof result.reason).toBe('string');
      }
    });

    it('verify never throws (returns VerifyResult even on bad input)', () => {
      expect(() => plugin.verify(makeEmptyReq(), null)).not.toThrow();
    });

    it('mapToTask(event, []) returns empty array (no candidates = no matches)', () => {
      // Use a minimal event shape — mapToTask should handle empty candidates safely
      // regardless of event type.
      const minimalEvent = {};
      const result = plugin.mapToTask(minimalEvent, []);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('mapToTask always returns an array', () => {
      const result = plugin.mapToTask({}, []);
      expect(Array.isArray(result)).toBe(true);
    });
  });
}

// Run the contract harness for both bundled plugins.
contractTest(githubPlugin);
contractTest(perforcePlugin);

// ---------------------------------------------------------------------------
// Plugin registry tests (D-02, D-03)
// ---------------------------------------------------------------------------

describe('pluginRegistry', () => {
  it('contains exactly github and perforce keys', () => {
    const keys = Array.from(pluginRegistry.keys()).sort();
    expect(keys).toEqual(['github', 'perforce']);
  });

  it('getPlugin("github") returns the github plugin', () => {
    const plugin = getPlugin('github');
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe('github');
  });

  it('getPlugin("perforce") returns the perforce plugin', () => {
    const plugin = getPlugin('perforce');
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe('perforce');
  });

  it('getPlugin("gitlab") returns undefined (unknown plugin)', () => {
    expect(getPlugin('gitlab')).toBeUndefined();
  });

  it('getPlugin("") returns undefined', () => {
    expect(getPlugin('')).toBeUndefined();
  });

  it('registry has exactly 2 entries', () => {
    expect(pluginRegistry.size).toBe(2);
  });
});
