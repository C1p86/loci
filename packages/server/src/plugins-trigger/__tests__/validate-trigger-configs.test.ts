/**
 * Unit tests for validateTriggerConfigs (D-18).
 * These are written BEFORE the implementation (TDD RED).
 */

import { describe, expect, it } from 'vitest';
import { validateTriggerConfigs } from '../validate-trigger-configs.js';

describe('validateTriggerConfigs', () => {
  it('returns [] for valid github config with push event', () => {
    const result = validateTriggerConfigs([{ plugin: 'github', events: ['push'] }]);
    expect(result).toEqual([]);
  });

  it('returns [] for valid github config with pull_request event', () => {
    const result = validateTriggerConfigs([{ plugin: 'github', events: ['pull_request'] }]);
    expect(result).toEqual([]);
  });

  it('returns [] for valid github config with multiple events and optional fields', () => {
    const result = validateTriggerConfigs([
      {
        plugin: 'github',
        events: ['push', 'pull_request'],
        repository: 'acme/*',
        branch: 'main',
        actions: ['opened', 'synchronize'],
      },
    ]);
    expect(result).toEqual([]);
  });

  it('returns [] for valid perforce config', () => {
    const result = validateTriggerConfigs([{ plugin: 'perforce' }]);
    expect(result).toEqual([]);
  });

  it('returns [] for valid perforce config with optional fields', () => {
    const result = validateTriggerConfigs([
      { plugin: 'perforce', depot: '//depot/infra/*', user: 'jsmith', client: 'jsmith-ws' },
    ]);
    expect(result).toEqual([]);
  });

  it('returns [] for empty array', () => {
    const result = validateTriggerConfigs([]);
    expect(result).toEqual([]);
  });

  it('returns error when input is not an array', () => {
    const result = validateTriggerConfigs('not-an-array');
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/must be an array/);
  });

  it('returns error when input is null', () => {
    const result = validateTriggerConfigs(null);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/must be an array/);
  });

  it('returns error for unknown plugin name', () => {
    const result = validateTriggerConfigs([{ plugin: 'gitlab' }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/plugin/);
    expect(result[0]?.message).toMatch(/gitlab/);
    expect(result[0]?.suggestion).toBeTruthy();
  });

  it('returns error for invalid github event', () => {
    const result = validateTriggerConfigs([{ plugin: 'github', events: ['invalid_event'] }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/invalid_event/);
    expect(result[0]?.suggestion).toMatch(/push/);
  });

  it('returns error for github config with empty events array', () => {
    const result = validateTriggerConfigs([{ plugin: 'github', events: [] }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/events/);
  });

  it('returns error for github config with missing events field', () => {
    const result = validateTriggerConfigs([{ plugin: 'github' }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/events/);
  });

  it('returns error for github config with non-string repository', () => {
    const result = validateTriggerConfigs([
      { plugin: 'github', events: ['push'], repository: 123 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/repository.*string/);
  });

  it('returns error for github config with non-string branch', () => {
    const result = validateTriggerConfigs([{ plugin: 'github', events: ['push'], branch: true }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/branch.*string/);
  });

  it('returns error for github config with invalid PR action', () => {
    const result = validateTriggerConfigs([
      { plugin: 'github', events: ['pull_request'], actions: ['invalid_action'] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/invalid_action/);
    expect(result[0]?.suggestion).toMatch(/opened/);
  });

  it('returns error for github config with non-array actions', () => {
    const result = validateTriggerConfigs([
      { plugin: 'github', events: ['pull_request'], actions: 'opened' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/actions.*array/);
  });

  it('returns error for perforce config with non-string depot', () => {
    const result = validateTriggerConfigs([{ plugin: 'perforce', depot: 123 }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/depot.*string/);
  });

  it('returns error for perforce config with non-string user', () => {
    const result = validateTriggerConfigs([{ plugin: 'perforce', user: 42 }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/user.*string/);
  });

  it('returns error for perforce config with non-string client', () => {
    const result = validateTriggerConfigs([{ plugin: 'perforce', client: [] }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/client.*string/);
  });

  it('returns error when entry is not an object', () => {
    const result = validateTriggerConfigs(['not-an-object']);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toMatch(/must be an object/);
  });

  it('caps errors at MAX_ERRORS (10)', () => {
    const input = Array.from({ length: 15 }, () => ({ plugin: 'gitlab' }));
    const result = validateTriggerConfigs(input);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('collects multiple errors for multiple entries', () => {
    const result = validateTriggerConfigs([
      { plugin: 'gitlab' },
      { plugin: 'github', events: [] },
      { plugin: 'perforce', depot: 999 },
    ]);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});
