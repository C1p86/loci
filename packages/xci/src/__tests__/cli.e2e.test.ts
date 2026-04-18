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
 * Create a temp directory with the given file map and a .xci/ subdirectory.
 * Keys are relative paths (e.g. ".xci/commands.yml"). Values are file content.
 */
function createTempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'xci-e2e-'));
  mkdirSync(join(dir, '.xci'), { recursive: true });
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
  // D-19: No .xci/ directory
  // ------------------------------------------------------------------

  it('D-19: no .xci/ directory shows friendly message', () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), 'xci-no-xci-')));
    const { stdout, code } = runCliInDir(dir, []);
    expect(code).not.toBe(0);
    expect(stdout).toContain('No .xci/ directory found');
  });

  it('D-19: --version works without .xci/ directory', () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), 'xci-no-xci-')));
    const { stdout, code } = runCliInDir(dir, ['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('D-19: --help works without .xci/ directory', () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), 'xci-no-xci-')));
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
        '.xci/commands.yml': 'build:\n  cmd: "echo build"\n  description: "Build project"\n',
        '.xci/config.yml': '',
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
        '.xci/commands.yml': 'build:\n  cmd: "echo build"\n  description: "Build project"\n',
        '.xci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['--list']);
    expect(code).toBe(0);
    expect(stdout).toContain('build');
  });

  it('CLI-03: -l short flag also shows alias list', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': 'build:\n  cmd: "echo build"\n  description: "Build project"\n',
        '.xci/config.yml': '',
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
        '.xci/commands.yml':
          "hello:\n  cmd: [\"node\", \"-e\", \"process.stdout.write('hello-xci')\"]\n",
        '.xci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['hello', '--log']);
    expect(code).toBe(0);
    expect(stdout).toContain('hello-xci');
  });

  // ------------------------------------------------------------------
  // EXE-03: non-zero exit code propagation
  // ------------------------------------------------------------------

  it('EXE-03: non-zero exit code is propagated', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': 'fail:\n  cmd: ["node", "-e", "process.exit(42)"]\n',
        '.xci/config.yml': '',
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
        '.xci/commands.yml': 'greet:\n  cmd: ["echo", "hello"]\n',
        '.xci/config.yml': '',
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
        '.xci/commands.yml': 'greet:\n  cmd: ["echo", "hello"]\n',
        '.xci/config.yml': '',
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
        '.xci/commands.yml':
          "greet:\n  cmd: [\"node\", \"-e\", \"process.stdout.write('hi')\"]\n",
        '.xci/config.yml': '',
      }),
    );
    const { stdout, stderr, code } = runCliInDir(dir, ['greet', '--verbose']);
    expect(code).toBe(0);
    expect(stderr).toContain('[verbose]');
    expect(stderr).toContain('.xci/config.yml');
    // Command was executed — stdout has the output
    expect(stdout).toContain('hi');
  });

  // ------------------------------------------------------------------
  // D-26: verbose shows project root
  // ------------------------------------------------------------------

  it('D-26: --verbose shows project root in stderr', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml':
          "greet:\n  cmd: [\"node\", \"-e\", \"process.stdout.write('hi')\"]\n",
        '.xci/config.yml': '',
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
        '.xci/commands.yml':
          "greet:\n  cmd: [\"node\", \"-e\", \"process.stdout.write('hi')\"]\n",
        '.xci/config.yml': '',
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
        '.xci/commands.yml': 'showargs:\n  cmd: ["node", "print-args.mjs"]\n',
        '.xci/config.yml': '',
        'print-args.mjs':
          "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n",
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['showargs', '--log', '--', '--foo', 'bar']);
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
        '.xci/commands.yml': 'build:\n  cmd: ["echo", "x"]\n',
        '.xci/config.yml': '',
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
        '.xci/commands.yml':
          'build:\n  cmd: ["echo", "x"]\n  description: "Builds it"\n',
        '.xci/config.yml': '',
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
        '.xci/commands.yml': 'build:\n  cmd: ["echo", "x"]\n',
        '.xci/config.yml': '',
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
        '.xci/commands.yml': ':::bad yaml:::\n',
        '.xci/config.yml': '',
      }),
    );
    const { stderr, code } = runCliInDir(dir, []);
    // COMMAND_ERROR is 20
    expect(code).toBe(20);
    expect(stderr.toLowerCase()).toMatch(/yaml|parse|invalid/);
  });

  // ------------------------------------------------------------------
  // D-19 gap regression: no .xci/ exits non-zero
  // ------------------------------------------------------------------

  it('D-19: no .xci/ directory exits non-zero when no --version/--help', () => {
    const dir = trackDir(mkdtempSync(join(tmpdir(), 'xci-no-xci-exit-')));
    const { stdout, code } = runCliInDir(dir, []);
    expect(stdout).toContain('No .xci/ directory found');
    expect(code).not.toBe(0);
  });

  // ------------------------------------------------------------------
  // Gap 1 regression: unknown alias clean output
  // ------------------------------------------------------------------

  it('CLI-09 / Gap 1: unknown alias shows clean error without commander noise', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': 'greet:\n  cmd: [echo, hello]\n',
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

  it('the bundle does not contain the __XCI_VERSION__ literal (tsup define replaced it)', async () => {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(CLI, 'utf8');
    expect(content).not.toContain('__XCI_VERSION__');
  });

  // ------------------------------------------------------------------
  // CLI-KV: KEY=VALUE positional parameter overrides
  // ------------------------------------------------------------------

  describe('CLI-KV: KEY=VALUE positional parameter overrides', () => {
    it('CLI-KV-01: KEY=VALUE overrides inject env var into child process', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml':
            'deploy:\n  cmd: ["node", "-e", "process.stdout.write(process.env.REGISTRY)"]\n',
          '.xci/config.yml': 'registry: default-registry\n',
        }),
      );
      const { stdout, code } = runCliInDir(dir, ['deploy', 'registry=http://localhost:5000', '--log']);
      expect(code).toBe(0);
      expect(stdout).toContain('http://localhost:5000');
    });

    it('CLI-KV-02: KEY=VALUE overrides env var (reads via process.env)', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml':
            'greet:\n  cmd: ["node", "-e", "process.stdout.write(process.env.GREETING)"]\n',
          '.xci/config.yml': 'greeting: hello\n',
        }),
      );
      const { stdout, code } = runCliInDir(dir, ['greet', 'greeting=world', '--log']);
      expect(code).toBe(0);
      expect(stdout).toContain('world');
    });

    it('CLI-KV-03: multiple KEY=VALUE args all override independently', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml':
            'info:\n  cmd: ["node", "-e", "process.stdout.write(process.env.A + \':\' + process.env.B)"]\n',
          '.xci/config.yml': 'a: original-a\nb: original-b\n',
        }),
      );
      const { stdout, code } = runCliInDir(dir, ['info', 'a=new-a', 'b=new-b', '--log']);
      expect(code).toBe(0);
      expect(stdout).toContain('new-a:new-b');
    });

    it('CLI-KV-04: CLI overrides have higher precedence than local.yml', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml':
            'show:\n  cmd: ["node", "-e", "process.stdout.write(process.env.MYVAR)"]\n',
          '.xci/config.yml': 'myvar: from-config\n',
          '.xci/local.yml': 'myvar: from-local\n',
        }),
      );
      const { stdout, code } = runCliInDir(dir, ['show', 'myvar=from-cli', '--log']);
      expect(code).toBe(0);
      expect(stdout).toContain('from-cli');
    });

    it('CLI-KV-05: args after -- are pass-through, not treated as overrides', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': 'showargs:\n  cmd: ["node", "print-args.mjs"]\n',
          '.xci/config.yml': '',
          'print-args.mjs': "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n",
        }),
      );
      const { stdout, code } = runCliInDir(dir, ['showargs', '--log', '--', 'baz=x']);
      expect(code).toBe(0);
      const args = JSON.parse(stdout.trim()) as string[];
      expect(args).toContain('baz=x');
    });

    it('CLI-KV-06: non-KEY=VALUE args before -- are treated as pass-through, not overrides', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': 'showargs:\n  cmd: ["node", "print-args.mjs"]\n',
          '.xci/config.yml': '',
          'print-args.mjs': "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n",
        }),
      );
      const { stdout, code } = runCliInDir(dir, ['showargs', 'not-an-override', '--log']);
      expect(code).toBe(0);
      const args = JSON.parse(stdout.trim()) as string[];
      expect(args).toContain('not-an-override');
    });

    it('CLI-KV-07: --dry-run shows CLI override values unredacted', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': 'deploy:\n  cmd: ["echo", "$' + '{registry}"]\n',
          '.xci/config.yml': 'registry: default\n',
        }),
      );
      const { stderr, code } = runCliInDir(dir, ['deploy', 'registry=http://localhost', '--dry-run']);
      expect(code).toBe(0);
      expect(stderr).toContain('http://localhost');
    });
  });

  // ------------------------------------------------------------------
  // XCI_PROJECT_PATH: always-available env var
  // ------------------------------------------------------------------

  it('XCI_PROJECT_PATH is injected as env var pointing to project root', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml':
          'show-root:\n  cmd: ["node", "-e", "process.stdout.write(process.env.XCI_PROJECT_PATH)"]\n',
        '.xci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['show-root', '--log']);
    expect(code).toBe(0);
    expect(stdout).toBe(dir);
  });

  it('${xci.project.path} is usable in command interpolation', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml':
          'show-interp:\n  cmd: ["node", "-e", "process.stdout.write(\'${xci.project.path}\')"]\n',
        '.xci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['show-interp', '--log']);
    expect(code).toBe(0);
    expect(stdout).toBe(dir);
  });

  it('${xci.project.path} works in --dry-run without errors', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml':
          'show-interp:\n  cmd: ["echo", "${xci.project.path}"]\n',
        '.xci/config.yml': '',
      }),
    );
    const { stderr, code } = runCliInDir(dir, ['show-interp', '--dry-run']);
    expect(code).toBe(0);
    expect(stderr).toContain(dir);
  });

  // ------------------------------------------------------------------
  // capture: stdout → variable for subsequent steps
  // ------------------------------------------------------------------

  describe('capture: stdout → variable', () => {
    it('captures stdout and passes as env var to next step', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': [
            'get-value:',
            '  cmd: ["node", "-e", "process.stdout.write(\'captured-text\')"]',
            '  capture: my_val',
            'pipeline:',
            '  steps:',
            '    - get-value',
            '    - use-value',
            'use-value:',
            '  cmd: ["node", "-e", "process.stdout.write(process.env.MY_VAL)"]',
          ].join('\n'),
          '.xci/config.yml': '',
        }),
      );
      const { stdout, code } = runCliInDir(dir, ['pipeline', '--log']);
      expect(code).toBe(0);
      expect(stdout).toContain('captured-text');
    });

    it('capture shows [capture] trace on stderr', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': [
            'get-id:',
            '  cmd: ["node", "-e", "process.stdout.write(\'abc123\')"]',
            '  capture: build_id',
            'pipe:',
            '  steps:',
            '    - get-id',
          ].join('\n'),
          '.xci/config.yml': '',
        }),
      );
      const { stderr, code } = runCliInDir(dir, ['pipe']);
      expect(code).toBe(0);
      expect(stderr).toContain('capture: build_id');
      expect(stderr).toContain('value: abc123');
      expect(stderr).toContain('PASS');
    });

    it('captured value is trimmed (no trailing newline)', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': [
            'get-val:',
            '  cmd: ["node", "-e", "console.log(\'trimmed\')"]',
            '  capture: val',
            'pipe:',
            '  steps:',
            '    - get-val',
            '    - show-val',
            'show-val:',
            '  cmd: ["node", "-e", "process.stdout.write(\'[\' + process.env.VAL + \']\')"]',
          ].join('\n'),
          '.xci/config.yml': '',
        }),
      );
      const { stdout, code } = runCliInDir(dir, ['pipe', '--log']);
      expect(code).toBe(0);
      expect(stdout).toContain('[trimmed]');
    });

    it('capture with type int validates and passes', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': [
            'get-count:',
            '  cmd: ["node", "-e", "process.stdout.write(\'42\')"]',
            '  capture:',
            '    var: count',
            '    type: int',
            '    assert: "> 0"',
            'pipe:',
            '  steps:',
            '    - get-count',
            '    - show-count',
            'show-count:',
            '  cmd: ["node", "-e", "process.stdout.write(process.env.COUNT)"]',
          ].join('\n'),
          '.xci/config.yml': '',
        }),
      );
      const { stdout, code } = runCliInDir(dir, ['pipe', '--log']);
      expect(code).toBe(0);
      expect(stdout).toContain('42');
    });

    it('capture with type int fails validation on non-integer', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': [
            'get-val:',
            '  cmd: ["node", "-e", "process.stdout.write(\'not-a-number\')"]',
            '  capture:',
            '    var: count',
            '    type: int',
            'pipe:',
            '  steps:',
            '    - get-val',
          ].join('\n'),
          '.xci/config.yml': '',
        }),
      );
      const { stderr, code } = runCliInDir(dir, ['pipe']);
      expect(code).not.toBe(0);
      expect(stderr).toContain('FAIL:');
      expect(stderr).toContain('expected int');
    });

    it('capture assert "not empty" fails on empty output', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': [
            'get-empty:',
            '  cmd: ["node", "-e", ""]',
            '  capture:',
            '    var: val',
            '    assert: "not empty"',
            'pipe:',
            '  steps:',
            '    - get-empty',
          ].join('\n'),
          '.xci/config.yml': '',
        }),
      );
      const { stderr, code } = runCliInDir(dir, ['pipe']);
      expect(code).not.toBe(0);
      expect(stderr).toContain('FAIL:');
    });

    it('capture with multiple assertions passes when all match', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': [
            'get-num:',
            '  cmd: ["node", "-e", "process.stdout.write(\'50\')"]',
            '  capture:',
            '    var: num',
            '    type: int',
            '    assert:',
            '      - ">= 0"',
            '      - "<= 100"',
            'pipe:',
            '  steps:',
            '    - get-num',
            '    - show-num',
            'show-num:',
            '  cmd: ["node", "-e", "process.stdout.write(process.env.NUM)"]',
          ].join('\n'),
          '.xci/config.yml': '',
        }),
      );
      const { stdout, code } = runCliInDir(dir, ['pipe', '--log']);
      expect(code).toBe(0);
      expect(stdout).toContain('50');
    });

    it('capture shows type in log output', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': [
            'get-id:',
            '  cmd: ["node", "-e", "process.stdout.write(\'7\')"]',
            '  capture:',
            '    var: build_id',
            '    type: int',
            'pipe:',
            '  steps:',
            '    - get-id',
          ].join('\n'),
          '.xci/config.yml': '',
        }),
      );
      const { stderr, code } = runCliInDir(dir, ['pipe']);
      expect(code).toBe(0);
      expect(stderr).toContain('capture: build_id');
      expect(stderr).toContain('value: 7');
      expect(stderr).toContain('PASS');
    });
  });
});
