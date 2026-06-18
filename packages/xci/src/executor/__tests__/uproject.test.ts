// src/executor/__tests__/uproject.test.ts
//
// Unit tests for the pure applyUprojectEdits function and formatting helpers.
// No file I/O in the applyUprojectEdits tests — uses the pure function directly.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyUprojectEdits, writeUproject } from '../uproject.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeUproject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    FileVersion: 3,
    EngineAssociation: '5.3',
    Category: '',
    Description: '',
    ...overrides,
  };
}

function makeUprojectWithPlugins(
  plugins: Array<{ Name: string; Enabled: boolean; [key: string]: unknown }>,
): Record<string, unknown> {
  return makeUproject({ Plugins: plugins });
}

// ---------------------------------------------------------------------------
// Temp dir cleanup
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// applyUprojectEdits — plugin enable
// ---------------------------------------------------------------------------

describe('applyUprojectEdits — enable', () => {
  it('enable existing disabled plugin → Enabled becomes true, other fields preserved, no warning', () => {
    const input = makeUprojectWithPlugins([
      { Name: 'MyPlugin', Enabled: false, WhitelistPlatforms: ['Win64'] },
    ]);
    const { json, warnings } = applyUprojectEdits(input, {
      plugins: { enable: ['MyPlugin'] },
    });
    const plugins = json.Plugins as Array<Record<string, unknown>>;
    expect(plugins[0]?.Enabled).toBe(true);
    expect(plugins[0]?.WhitelistPlatforms).toEqual(['Win64']);
    expect(warnings).toHaveLength(0);
  });

  it('enable already-enabled plugin → Enabled stays true, warning emitted (idempotency)', () => {
    const input = makeUprojectWithPlugins([{ Name: 'AlreadyOn', Enabled: true }]);
    const { json, warnings } = applyUprojectEdits(input, {
      plugins: { enable: ['AlreadyOn'] },
    });
    const plugins = json.Plugins as Array<Record<string, unknown>>;
    expect(plugins[0]?.Enabled).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('AlreadyOn');
    expect(warnings[0]).toContain('already enabled');
  });

  it('enable absent plugin → appends { Name, Enabled: true } to Plugins', () => {
    const input = makeUprojectWithPlugins([{ Name: 'OtherPlugin', Enabled: false }]);
    const { json, warnings } = applyUprojectEdits(input, {
      plugins: { enable: ['NewPlugin'] },
    });
    const plugins = json.Plugins as Array<Record<string, unknown>>;
    expect(plugins).toHaveLength(2);
    const newEntry = plugins.find((p) => p.Name === 'NewPlugin');
    expect(newEntry).toBeDefined();
    expect(newEntry?.Enabled).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('enable absent plugin when json.Plugins is undefined → creates Plugins array with the entry', () => {
    const input = makeUproject(); // no Plugins key
    expect(input.Plugins).toBeUndefined();
    const { json, warnings } = applyUprojectEdits(input, {
      plugins: { enable: ['BrandNew'] },
    });
    expect(Array.isArray(json.Plugins)).toBe(true);
    const plugins = json.Plugins as Array<Record<string, unknown>>;
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.Name).toBe('BrandNew');
    expect(plugins[0]?.Enabled).toBe(true);
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyUprojectEdits — plugin disable
// ---------------------------------------------------------------------------

describe('applyUprojectEdits — disable', () => {
  it('disable existing plugin → Enabled:false, other fields preserved', () => {
    const input = makeUprojectWithPlugins([
      { Name: 'EnabledPlugin', Enabled: true, OptionalPlugin: true },
    ]);
    const { json, warnings } = applyUprojectEdits(input, {
      plugins: { disable: ['EnabledPlugin'] },
    });
    const plugins = json.Plugins as Array<Record<string, unknown>>;
    expect(plugins[0]?.Enabled).toBe(false);
    expect(plugins[0]?.OptionalPlugin).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('disable already-disabled plugin → stays false, warning emitted (idempotency)', () => {
    const input = makeUprojectWithPlugins([{ Name: 'AlreadyOff', Enabled: false }]);
    const { json, warnings } = applyUprojectEdits(input, {
      plugins: { disable: ['AlreadyOff'] },
    });
    const plugins = json.Plugins as Array<Record<string, unknown>>;
    expect(plugins[0]?.Enabled).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('already disabled');
  });

  it('disable absent plugin → appends { Name, Enabled: false }, no warning', () => {
    const input = makeUprojectWithPlugins([{ Name: 'SomePlugin', Enabled: true }]);
    const { json, warnings } = applyUprojectEdits(input, {
      plugins: { disable: ['MetaXrUtilsLibrary'] },
    });
    const plugins = json.Plugins as Array<Record<string, unknown>>;
    expect(plugins).toHaveLength(2); // new disabled entry added
    expect(plugins[1]).toEqual({ Name: 'MetaXrUtilsLibrary', Enabled: false });
    expect(warnings).toHaveLength(0);
  });

  it('disable absent plugin when Plugins array is missing → creates array with disabled entry', () => {
    const input = makeUproject(); // no Plugins
    const { json, warnings } = applyUprojectEdits(input, {
      plugins: { disable: ['MetaXrUtilsLibrary'] },
    });
    const plugins = json.Plugins as Array<Record<string, unknown>>;
    expect(plugins).toEqual([{ Name: 'MetaXrUtilsLibrary', Enabled: false }]);
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyUprojectEdits — plugin remove
// ---------------------------------------------------------------------------

describe('applyUprojectEdits — remove', () => {
  it('remove present plugin → entry deleted from Plugins', () => {
    const input = makeUprojectWithPlugins([
      { Name: 'ToRemove', Enabled: true },
      { Name: 'KeepMe', Enabled: false },
    ]);
    const { json, warnings } = applyUprojectEdits(input, {
      plugins: { remove: ['ToRemove'] },
    });
    const plugins = json.Plugins as Array<Record<string, unknown>>;
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.Name).toBe('KeepMe');
    expect(warnings).toHaveLength(0);
  });

  it('remove absent plugin → warning emitted, no throw', () => {
    const input = makeUprojectWithPlugins([{ Name: 'Existing', Enabled: true }]);
    const { json, warnings } = applyUprojectEdits(input, {
      plugins: { remove: ['Ghost'] },
    });
    const plugins = json.Plugins as Array<Record<string, unknown>>;
    expect(plugins).toHaveLength(1); // unchanged
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Ghost');
    expect(warnings[0]).toContain('not found');
    expect(warnings[0]).toContain('remove skipped');
  });

  it('remove absent plugin when Plugins array is missing → warning, no throw', () => {
    const input = makeUproject();
    const { json, warnings } = applyUprojectEdits(input, {
      plugins: { remove: ['Missing'] },
    });
    expect(json.Plugins).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// applyUprojectEdits — set top-level fields
// ---------------------------------------------------------------------------

describe('applyUprojectEdits — set', () => {
  it('set top-level fields (e.g. EngineAssociation, Description) → assigned', () => {
    const input = makeUproject({ EngineAssociation: '5.3', Description: '' });
    const { json, warnings } = applyUprojectEdits(input, {
      set: { EngineAssociation: '5.4', Description: 'My project' },
    });
    expect(json.EngineAssociation).toBe('5.4');
    expect(json.Description).toBe('My project');
    expect(warnings).toHaveLength(0);
  });

  it('existing keys are not reordered after set', () => {
    const input = { FileVersion: 3, EngineAssociation: '5.3', Category: '', Description: '' };
    const { json } = applyUprojectEdits(input, {
      set: { EngineAssociation: '5.4' },
    });
    const keys = Object.keys(json);
    expect(keys[0]).toBe('FileVersion');
    expect(keys[1]).toBe('EngineAssociation');
    expect(keys[2]).toBe('Category');
  });

  it('new keys from set are appended at end', () => {
    const input = { FileVersion: 3, EngineAssociation: '5.3' };
    const { json } = applyUprojectEdits(input, {
      set: { NewField: 'new-value' },
    });
    const keys = Object.keys(json);
    expect(keys[keys.length - 1]).toBe('NewField');
    expect(json.NewField).toBe('new-value');
  });
});

// ---------------------------------------------------------------------------
// Immutability: input is NOT mutated
// ---------------------------------------------------------------------------

describe('applyUprojectEdits — immutability', () => {
  it('input object is NOT mutated (returned json is a new object)', () => {
    const input = makeUprojectWithPlugins([{ Name: 'Plugin', Enabled: false }]);
    const inputCopy = JSON.stringify(input);

    applyUprojectEdits(input, {
      plugins: { enable: ['Plugin'] },
      set: { Description: 'changed' },
    });

    // Input must remain unchanged
    expect(JSON.stringify(input)).toBe(inputCopy);
  });
});

// ---------------------------------------------------------------------------
// Formatting: writeUproject produces 2-space indent + trailing newline
// ---------------------------------------------------------------------------

describe('writeUproject formatting', () => {
  it('writeUproject output uses 2-space indentation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xci-uproject-test-'));
    tempDirs.push(dir);

    const filePath = join(dir, 'test.uproject');
    const json = { FileVersion: 3, EngineAssociation: '5.4' };
    writeUproject(filePath, json);

    const content = readFileSync(filePath, 'utf8');
    // Check 2-space indentation: lines inside the object should start with "  "
    const lines = content.split('\n');
    const fieldLine = lines.find((l) => l.includes('FileVersion'));
    expect(fieldLine).toBeDefined();
    expect(fieldLine).toMatch(/^  /); // leading 2 spaces
    expect(fieldLine).not.toMatch(/^    /); // NOT 4 spaces
  });

  it('writeUproject output ends with exactly one trailing newline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xci-uproject-test-'));
    tempDirs.push(dir);

    const filePath = join(dir, 'test.uproject');
    const json = { FileVersion: 3 };
    writeUproject(filePath, json);

    const content = readFileSync(filePath, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    // Only ONE trailing newline (not two)
    expect(content.endsWith('\n\n')).toBe(false);
  });

  it('writeUproject round-trip: written JSON can be re-parsed to original', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xci-uproject-test-'));
    tempDirs.push(dir);

    const filePath = join(dir, 'round-trip.uproject');
    const original = {
      FileVersion: 3,
      EngineAssociation: '5.4',
      Plugins: [{ Name: 'P', Enabled: true }],
    };
    writeUproject(filePath, original);

    const content = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed).toEqual(original);
  });
});
