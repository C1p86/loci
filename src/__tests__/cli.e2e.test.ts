// src/__tests__/cli.e2e.test.ts
//
// E2E tests for the full xci CLI.
// NOTE: `npm run build` must be run before these tests. CI orders build → test automatically.
// Locally: `npm run build && npm test`

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const CLI = resolve(process.cwd(), 'dist/cli.mjs');

/* ------------------------------------------------------------------ */
/* Core test runner (no cwd — runs in process.cwd())                    */
/* ------------------------------------------------------------------ */

function runCli(args: readonly string[]): { stdout: string; stderr: string; code: number } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status ?? -1,
  };
}

/* ------------------------------------------------------------------ */
/* Temp project helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Create a temp directory with the given file map and a .loci/ subdirectory.
 * Keys are relative paths (e.g. ".loci/commands.yml"). Values are file content.
 */
function createTempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'loci-e2e-'));
  mkdirSync(join(dir, '.loci'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(dir, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }
  return dir;
}

/**
 * Run the CLI in a specific directory with optional extra env vars.
 */
function runCliInDir(
  dir: string,
  args: readonly string[],
  extraEnv?: Record<string, string>,
): { stdout: string; stderr: string; code: number } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: dir,
    env: { ...process.env, ...extraEnv, NO_COLOR: '1' },
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status ?? -1 };
}

/* ------------------------------------------------------------------ */
/* Temp dir cleanup                                                      */
/* ------------------------------------------------------------------ */

const tempDirs: string[] = [];

function trackDir(dir: string): string {
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

/* ------------------------------------------------------------------ */
/* Guards                                                                */
/* ------------------------------------------------------------------ */

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error(
      `dist/cli.mjs is missing. Run \`npm run build\` before \`npm test\`. Expected at: ${CLI}`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Tests                                                                 */
/* ------------------------------------------------------------------ */

describe('xci CLI (E2E via spawnSync on dist/cli.mjs)', () => {
  // ------------------------------------------------------------------
  // CLI-08: --version
  // ------------------------------------------------------------------

  it('--version prints semver and exits 0', () => {
    const { stdout, code } = runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(stdout.trim()).toBe('0.0.0');
  });

  it('-V short flag also prints version', () => {
    const { stdout, code } = runCli(['-V']);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('0.0.0');
  });

  // ------------------------------------------------------------------
  // D-19: No .loci/ directory
  // ------------------------------------------------------------------

  it('D-19: no .loci/ directory shows friendly message', () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), 'loci-no-loci-')));
    const { stdout, code } = runCliInDir(dir, []);
    expect(code).not.toBe(0);
    expect(stdout).toContain('No .loci/ directory found');
  });

  it('D-19: --version works without .loci/ directory', () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), 'loci-no-loci-')));
    const { stdout, code } = runCliInDir(dir, ['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('D-19: --help works without .loci/ directory', () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), 'loci-no-loci-')));
    const { stdout, code } = runCliInDir(dir, ['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: xci');
  });

  // ------------------------------------------------------------------
  // CLI-02, D-20: no args with aliases shows alias list
  // ------------------------------------------------------------------

  it('CLI-02, D-20: no args with aliases shows alias list', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'build:\n  cmd: "echo build"\n  description: "Build project"\n',
        '.loci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(dir, []);
    expect(code).toBe(0);
    expect(stdout).toContain('build');
    expect(stdout).toContain('Build project');
  });

  // ------------------------------------------------------------------
  // CLI-03, D-21: --list flag
  // ------------------------------------------------------------------

  it('CLI-03, D-21: --list shows alias list', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'build:\n  cmd: "echo build"\n  description: "Build project"\n',
        '.loci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['--list']);
    expect(code).toBe(0);
    expect(stdout).toContain('build');
  });

  it('CLI-03: -l short flag also shows alias list', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'build:\n  cmd: "echo build"\n  description: "Build project"\n',
        '.loci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['-l']);
    expect(code).toBe(0);
    expect(stdout).toContain('build');
  });

  // ------------------------------------------------------------------
  // CLI-01: alias execution
  // ------------------------------------------------------------------

  it('CLI-01: alias execution runs the command and exits 0', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml':
          "hello:\n  cmd: [\"node\", \"-e\", \"process.stdout.write('hello-loci')\"]\n",
        '.loci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['hello']);
    expect(code).toBe(0);
    expect(stdout).toContain('hello-loci');
  });

  // ------------------------------------------------------------------
  // EXE-03: non-zero exit code propagation
  // ------------------------------------------------------------------

  it('EXE-03: non-zero exit code is propagated', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'fail:\n  cmd: ["node", "-e", "process.exit(42)"]\n',
        '.loci/config.yml': '',
      }),
    );
    const { code } = runCliInDir(dir, ['fail']);
    expect(code).toBe(42);
  });

  // ------------------------------------------------------------------
  // CLI-06, D-27: --dry-run
  // ------------------------------------------------------------------

  it('CLI-06, D-27: --dry-run prints to stderr, does not execute', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'greet:\n  cmd: ["echo", "hello"]\n',
        '.loci/config.yml': '',
      }),
    );
    const { stdout, stderr, code } = runCliInDir(dir, ['greet', '--dry-run']);
    expect(code).toBe(0);
    expect(stderr).toContain('[dry-run]');
    expect(stderr).toContain('echo');
    expect(stderr).toContain('hello');
    // stdout should be empty (command not executed)
    expect(stdout).toBe('');
  });

  // ------------------------------------------------------------------
  // D-30: diagnostics to stderr only
  // ------------------------------------------------------------------

  it('D-30: --dry-run output goes to stderr only (stdout is empty)', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'greet:\n  cmd: ["echo", "hello"]\n',
        '.loci/config.yml': '',
      }),
    );
    const { stdout } = runCliInDir(dir, ['greet', '--dry-run']);
    expect(stdout).toBe('');
  });

  // ------------------------------------------------------------------
  // CLI-07, D-28: --verbose
  // ------------------------------------------------------------------

  it('CLI-07, D-28: --verbose shows config trace on stderr and executes', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml':
          "greet:\n  cmd: [\"node\", \"-e\", \"process.stdout.write('hi')\"]\n",
        '.loci/config.yml': '',
      }),
    );
    const { stdout, stderr, code } = runCliInDir(dir, ['greet', '--verbose']);
    expect(code).toBe(0);
    expect(stderr).toContain('[verbose]');
    expect(stderr).toContain('.loci/config.yml');
    // Command was executed — stdout has the output
    expect(stdout).toContain('hi');
  });

  // ------------------------------------------------------------------
  // D-26: verbose shows project root
  // ------------------------------------------------------------------

  it('D-26: --verbose shows project root in stderr', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml':
          "greet:\n  cmd: [\"node\", \"-e\", \"process.stdout.write('hi')\"]\n",
        '.loci/config.yml': '',
      }),
    );
    const { stderr } = runCliInDir(dir, ['greet', '--verbose']);
    // The temp dir path should appear in verbose trace
    expect(stderr).toContain(dir);
  });

  // ------------------------------------------------------------------
  // D-29: --verbose --dry-run combo
  // ------------------------------------------------------------------

  it('D-29: --verbose --dry-run shows both traces on stderr, no execution', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml':
          "greet:\n  cmd: [\"node\", \"-e\", \"process.stdout.write('hi')\"]\n",
        '.loci/config.yml': '',
      }),
    );
    const { stdout, stderr, code } = runCliInDir(dir, ['greet', '--verbose', '--dry-run']);
    expect(code).toBe(0);
    expect(stderr).toContain('[verbose]');
    expect(stderr).toContain('[dry-run]');
    // No execution — stdout empty
    expect(stdout).toBe('');
  });

  // ------------------------------------------------------------------
  // CLI-05: pass-through args via --
  // ------------------------------------------------------------------

  it('CLI-05: pass-through args via -- are passed to the child', () => {
    // Use a script file to avoid node treating --foo as a node option when using `node -e`
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'showargs:\n  cmd: ["node", "print-args.mjs"]\n',
        '.loci/config.yml': '',
        'print-args.mjs':
          "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n",
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['showargs', '--', '--foo', 'bar']);
    expect(code).toBe(0);
    expect(stdout).toContain('--foo');
    expect(stdout).toContain('bar');
  });

  // ------------------------------------------------------------------
  // CLI-04: --help general
  // ------------------------------------------------------------------

  it('CLI-04: --help shows usage', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'build:\n  cmd: ["echo", "x"]\n',
        '.loci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: xci');
  });

  // ------------------------------------------------------------------
  // CLI-04, D-22: per-alias --help
  // ------------------------------------------------------------------

  it('CLI-04, D-22: per-alias --help shows description and command type', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml':
          'build:\n  cmd: ["echo", "x"]\n  description: "Builds it"\n',
        '.loci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['build', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Builds it');
    expect(stdout).toContain('Command type: single');
  });

  // ------------------------------------------------------------------
  // D-24, CLI-09: unknown alias exits with code 50
  // ------------------------------------------------------------------

  it('D-24, CLI-09: unknown alias exits with code 50 and stderr contains error', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'build:\n  cmd: ["echo", "x"]\n',
        '.loci/config.yml': '',
      }),
    );
    const { stderr, code } = runCliInDir(dir, ['nonexistent']);
    expect(code).toBe(50);
    expect(stderr.toLowerCase()).toContain('unknown');
  });

  // ------------------------------------------------------------------
  // CLI-09: YAML parse error in commands.yml
  // ------------------------------------------------------------------

  it('CLI-09: YAML parse error in commands.yml exits with error code', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': ':::bad yaml:::\n',
        '.loci/config.yml': '',
      }),
    );
    const { stderr, code } = runCliInDir(dir, []);
    // COMMAND_ERROR is 20
    expect(code).toBe(20);
    expect(stderr.toLowerCase()).toMatch(/yaml|parse|invalid/);
  });

  // ------------------------------------------------------------------
  // D-19 gap regression: no .loci/ exits non-zero
  // ------------------------------------------------------------------

  it('D-19: no .loci/ directory exits non-zero when no --version/--help', () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), 'loci-no-loci-exit-')));
    const { stdout, code } = runCliInDir(dir, []);
    expect(stdout).toContain('No .loci/ directory found');
    expect(code).not.toBe(0);
  });

  // ------------------------------------------------------------------
  // Gap 1 regression: unknown alias clean output
  // ------------------------------------------------------------------

  it('CLI-09 / Gap 1: unknown alias shows clean error without commander noise', () => {
    const dir = trackDir(
      createTempProject({
        '.loci/commands.yml': 'greet:\n  cmd: [echo, hello]\n',
      }),
    );
    const { stderr, code } = runCliInDir(dir, ['nonexistent']);
    expect(code).toBe(50);
    expect(stderr).toContain('Unknown alias');
    // Must NOT contain commander's raw excessArguments phrasing
    expect(stderr).not.toMatch(/too many arguments/i);
    expect(stderr).not.toMatch(/excess arguments/i);
  });

  // ------------------------------------------------------------------
  // Bundle shebang
  // ------------------------------------------------------------------

  it('the bundle has the shebang as the literal first line', async () => {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(CLI, 'utf8');
    expect(content.slice(0, 19)).toBe('#!/usr/bin/env node');
  });

  it('the bundle does not contain the __LOCI_VERSION__ literal (tsup define replaced it)', async () => {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(CLI, 'utf8');
    expect(content).not.toContain('__LOCI_VERSION__');
  });
});
