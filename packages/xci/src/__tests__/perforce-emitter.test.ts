// packages/xci/src/__tests__/perforce-emitter.test.ts
// Plan 12-05 Task 1 — Unit tests for perforce-emitter module (TDD RED/GREEN)
//
// Tests:
//   1. buildShTemplate produces correct POSIX sh script
//   2. buildPs1Template produces correct PowerShell script
//   3. buildBatTemplate produces correct Windows .bat script
//   4. emitPerforceTriggerScripts writes 3 files + returns correct filenames
//   5. Security: token with invalid characters throws InvalidTokenFormatError

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildBatTemplate,
  buildPs1Template,
  buildShTemplate,
  emitPerforceTriggerScripts,
} from '../perforce-emitter.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'xci-perforce-test-'));
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('buildShTemplate', () => {
  it('starts with #!/bin/sh shebang', () => {
    const out = buildShTemplate('https://x.y/z', 'tok');
    expect(out.split('\n')[0]).toBe('#!/bin/sh');
  });

  it('contains curl --fail', () => {
    const out = buildShTemplate('https://x.y/z', 'tok');
    expect(out).toContain('curl --fail');
  });

  it('includes X-Xci-Token header with the token', () => {
    const out = buildShTemplate('https://x.y/z', 'tok123');
    expect(out).toContain('X-Xci-Token: tok123');
  });

  it('includes Content-Type: application/json header', () => {
    const out = buildShTemplate('https://x.y/z', 'tok');
    expect(out).toContain('Content-Type: application/json');
  });

  it('includes the endpoint URL', () => {
    const out = buildShTemplate('https://x.y/z', 'tok');
    expect(out).toContain('https://x.y/z');
  });

  it('includes all P4 env var references', () => {
    const out = buildShTemplate('https://x.y/z', 'tok');
    expect(out).toContain('P4_CHANGE');
    expect(out).toContain('P4_USER');
    expect(out).toContain('P4_CLIENT');
    expect(out).toContain('P4_ROOT');
    expect(out).toContain('P4_DEPOT_PATH');
  });

  it('includes delivery_id in JSON body', () => {
    const out = buildShTemplate('https://x.y/z', 'tok');
    expect(out).toContain('delivery_id');
  });

  it('includes --data-raw or -d for request body', () => {
    const out = buildShTemplate('https://x.y/z', 'tok');
    expect(out).toMatch(/--data-raw|--data|-d /);
  });

  it('includes security warning comment', () => {
    const out = buildShTemplate('https://x.y/z', 'tok');
    expect(out.toLowerCase()).toMatch(/security|token|guard|restrict/i);
  });

  it('uses POST method', () => {
    const out = buildShTemplate('https://x.y/z', 'tok');
    expect(out).toContain('POST');
  });
});

describe('buildPs1Template', () => {
  it('includes Invoke-WebRequest', () => {
    const out = buildPs1Template('https://u.v/w', 'tok456');
    expect(out).toContain('Invoke-WebRequest');
  });

  it('includes the endpoint URL', () => {
    const out = buildPs1Template('https://u.v/w', 'tok456');
    expect(out).toContain("'https://u.v/w'");
  });

  it('includes X-Xci-Token header with token value', () => {
    const out = buildPs1Template('https://u.v/w', 'tok456');
    expect(out).toContain('X-Xci-Token');
    expect(out).toContain('tok456');
  });

  it('uses POST method', () => {
    const out = buildPs1Template('https://u.v/w', 'tok456');
    expect(out).toContain('POST');
  });

  it('uses NewGuid() for delivery_id', () => {
    const out = buildPs1Template('https://u.v/w', 'tok456');
    expect(out).toContain('[guid]::NewGuid()');
  });

  it('includes all P4 env var references', () => {
    const out = buildPs1Template('https://u.v/w', 'tok456');
    expect(out).toContain('P4_CHANGE');
    expect(out).toContain('P4_USER');
    expect(out).toContain('P4_CLIENT');
    expect(out).toContain('P4_ROOT');
    expect(out).toContain('P4_DEPOT_PATH');
  });

  it('uses -UseBasicParsing flag', () => {
    const out = buildPs1Template('https://u.v/w', 'tok456');
    expect(out).toContain('-UseBasicParsing');
  });
});

describe('buildBatTemplate', () => {
  it('starts with @echo off', () => {
    const out = buildBatTemplate('https://u.v', 'tokBat');
    expect(out.split('\n')[0]).toBe('@echo off');
  });

  it('includes powershell -NoProfile', () => {
    const out = buildBatTemplate('https://u.v', 'tokBat');
    expect(out).toContain('powershell -NoProfile');
  });

  it('includes the endpoint URL', () => {
    const out = buildBatTemplate('https://u.v', 'tokBat');
    expect(out).toContain('https://u.v');
  });

  it('includes the token', () => {
    const out = buildBatTemplate('https://u.v', 'tokBat');
    expect(out).toContain('tokBat');
  });

  it('includes P4 env vars using %VAR% syntax', () => {
    const out = buildBatTemplate('https://u.v', 'tokBat');
    expect(out).toContain('P4_CHANGE');
    expect(out).toContain('P4_USER');
    expect(out).toContain('P4_CLIENT');
    expect(out).toContain('P4_ROOT');
    expect(out).toContain('P4_DEPOT_PATH');
  });
});

describe('emitPerforceTriggerScripts', () => {
  it('writes 3 files and returns their names', () => {
    const result = emitPerforceTriggerScripts({
      url: 'https://example.com/hooks/perforce/tk',
      token: 'tok789',
      outputDir: tmpDir,
    });

    expect(result.files).toHaveLength(3);
    expect(result.files).toContain('trigger.sh');
    expect(result.files).toContain('trigger.bat');
    expect(result.files).toContain('trigger.ps1');
  });

  it('trigger.sh starts with #!/bin/sh', () => {
    emitPerforceTriggerScripts({
      url: 'https://example.com/hooks/perforce/tk',
      token: 'tok789',
      outputDir: tmpDir,
    });
    const sh = readFileSync(join(tmpDir, 'trigger.sh'), 'utf8');
    expect(sh.split('\n')[0]).toBe('#!/bin/sh');
  });

  it('trigger.ps1 contains Invoke-WebRequest', () => {
    emitPerforceTriggerScripts({
      url: 'https://example.com/hooks/perforce/tk',
      token: 'tok789',
      outputDir: tmpDir,
    });
    const ps1 = readFileSync(join(tmpDir, 'trigger.ps1'), 'utf8');
    expect(ps1).toContain('Invoke-WebRequest');
  });

  it('trigger.bat starts with @echo off', () => {
    emitPerforceTriggerScripts({
      url: 'https://example.com/hooks/perforce/tk',
      token: 'tok789',
      outputDir: tmpDir,
    });
    const bat = readFileSync(join(tmpDir, 'trigger.bat'), 'utf8');
    expect(bat.split('\n')[0]).toBe('@echo off');
  });

  it('all files contain the URL and token', () => {
    const url = 'https://example.com/hooks/perforce/xyz';
    const token = 'tok999';
    emitPerforceTriggerScripts({ url, token, outputDir: tmpDir });

    const sh = readFileSync(join(tmpDir, 'trigger.sh'), 'utf8');
    const ps1 = readFileSync(join(tmpDir, 'trigger.ps1'), 'utf8');
    const bat = readFileSync(join(tmpDir, 'trigger.bat'), 'utf8');

    expect(sh).toContain(url);
    expect(sh).toContain(token);
    expect(ps1).toContain(url);
    expect(ps1).toContain(token);
    expect(bat).toContain(url);
    expect(bat).toContain(token);
  });

  it('creates outputDir if it does not exist', () => {
    const nestedDir = join(tmpDir, 'a', 'b', 'c');
    emitPerforceTriggerScripts({
      url: 'https://example.com/hooks/perforce/tk',
      token: 'abc',
      outputDir: nestedDir,
    });
    expect(existsSync(join(nestedDir, 'trigger.sh'))).toBe(true);
  });
});

describe('token format validation (security)', () => {
  it('throws InvalidTokenFormatError for token with double-quote character', () => {
    expect(() =>
      emitPerforceTriggerScripts({
        url: 'https://example.com',
        token: 'tok"123',
        outputDir: tmpDir,
      })
    ).toThrow('InvalidTokenFormatError');
  });

  it('throws InvalidTokenFormatError for token with shell metacharacter $', () => {
    expect(() =>
      emitPerforceTriggerScripts({
        url: 'https://example.com',
        token: 'tok$123',
        outputDir: tmpDir,
      })
    ).toThrow('InvalidTokenFormatError');
  });

  it('accepts valid base64url token', () => {
    expect(() =>
      emitPerforceTriggerScripts({
        url: 'https://example.com',
        token: 'xci_whk_abc123_XYZ+/=-',
        outputDir: tmpDir,
      })
    ).not.toThrow();
  });
});
