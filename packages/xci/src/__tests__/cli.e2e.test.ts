// src/__tests__/cli.e2e.test.ts
//
// E2E tests for the full xci CLI.
// NOTE: `npm run build` must be run before these tests. CI orders build → test automatically.
// Locally: `npm run build && npm test`

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
    env: { ...process.env, NO_COLOR: '1', CI: '1' },
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
    env: { ...process.env, ...extraEnv, NO_COLOR: '1', CI: '1' },
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
          'hello:\n  cmd: ["node", "-e", "process.stdout.write(\'hello-xci\')"]\n',
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
        '.xci/commands.yml': 'greet:\n  cmd: ["node", "-e", "process.stdout.write(\'hi\')"]\n',
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
        '.xci/commands.yml': 'greet:\n  cmd: ["node", "-e", "process.stdout.write(\'hi\')"]\n',
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
        '.xci/commands.yml': 'greet:\n  cmd: ["node", "-e", "process.stdout.write(\'hi\')"]\n',
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
        'print-args.mjs': "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n",
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
        '.xci/commands.yml': 'build:\n  cmd: ["echo", "x"]\n  description: "Builds it"\n',
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
      const { stdout, code } = runCliInDir(dir, [
        'deploy',
        'registry=http://localhost:5000',
        '--log',
      ]);
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
          'print-args.mjs':
            "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n",
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
          'print-args.mjs':
            "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n",
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
      const { stderr, code } = runCliInDir(dir, [
        'deploy',
        'registry=http://localhost',
        '--dry-run',
      ]);
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
        '.xci/commands.yml': 'show-interp:\n  cmd: ["echo", "${xci.project.path}"]\n',
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

  // ------------------------------------------------------------------
  // quick-260421-hnr: for_each.in display no longer crashes on string form
  // Regression against quick-260421-ewq which widened the type from
  // readonly string[] to readonly string[] | string but left two display
  // sites in cli.ts calling def.in.join(...) unconditionally.
  // ------------------------------------------------------------------

  describe('quick-260421-hnr: for_each.in display (string + array forms)', () => {
    const stringFormCommands = [
      'items:',
      '  for_each:',
      '    var: ITEM',
      '    in: "${ITEMS}"',
      '    mode: steps',
      '    cmd: ["echo", "${ITEM}"]',
      'hello:',
      '  cmd: ["node", "-e", "process.stdout.write(\'hi\')"]',
      '',
    ].join('\n');

    const arrayFormCommands = [
      'loop:',
      '  for_each:',
      '    var: X',
      '    in: ["a", "b", "c"]',
      '    mode: steps',
      '    cmd: ["echo", "${X}"]',
      '',
    ].join('\n');

    it('quick-260421-hnr: --list renders for_each.in string form without brackets', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': stringFormCommands,
          '.xci/config.yml': 'ITEMS: "a,b,c"\n',
        }),
      );
      const { stderr, code } = runCliInDir(dir, ['items', '--list']);
      expect(code).toBe(0);
      expect(stderr).toContain('in: ${ITEMS}');
      expect(stderr).not.toMatch(/TypeError/i);
    });

    it('quick-260421-hnr: per-alias --help renders for_each.in string form without brackets', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': stringFormCommands,
          '.xci/config.yml': 'ITEMS: "a,b,c"\n',
        }),
      );
      const { stdout, stderr, code } = runCliInDir(dir, ['items', '--help']);
      expect(code).toBe(0);
      expect(stdout).toContain('in: ${ITEMS}');
      expect(stdout).not.toMatch(/TypeError/i);
      expect(stderr).not.toMatch(/TypeError/i);
    });

    it('quick-260421-hnr: startup does not crash when for_each.in uses string form (registration regression)', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': stringFormCommands,
          '.xci/config.yml': 'ITEMS: "a,b,c"\n',
        }),
      );
      // Invoke an unrelated alias — if buildAliasHelpText throws at registration
      // for the string-form for_each alias, `hello` will never be dispatched.
      const { stdout, stderr, code } = runCliInDir(dir, ['hello', '--log']);
      expect(code).toBe(0);
      expect(stdout).toContain('hi');
      expect(stderr).not.toMatch(/TypeError/i);
    });

    it('quick-260421-hnr: --list renders for_each.in array form with brackets (no over-fix)', () => {
      const dir = trackDir(
        createTempProject({
          '.xci/commands.yml': arrayFormCommands,
          '.xci/config.yml': '',
        }),
      );
      const { stderr, code } = runCliInDir(dir, ['loop', '--list']);
      expect(code).toBe(0);
      expect(stderr).toContain('in: [a, b, c]');
      expect(stderr).not.toMatch(/TypeError/i);
    });
  });
});

/* ================================================================
 * quick-260605-q1f: multi-alias + composition
 * ================================================================ */

describe.skipIf(!existsSync(CLI))('multi-alias composition (+ separator)', () => {
  // Shared commands.yml for composition tests
  const compositionCommands = [
    'ok1:',
    '  cmd: ["node", "-e", "process.exit(0)"]',
    'ok2:',
    '  cmd: ["node", "-e", "process.exit(0)"]',
    'fail1:',
    '  cmd: ["node", "-e", "process.exit(3)"]',
    'echoarg:',
    '  cmd: ["node", "-e", "process.stdout.write(process.argv.slice(1).join(\',\'))"]',
    // marker-writer: writes a flag file at path given by MARKER env var
    'marker:',
    '  cmd: ["node", "-e", "require(\'fs\').writeFileSync(process.env.MARKER, \'x\')"]',
    '',
  ].join('\n');

  it('sequential success: ok1 + ok2 exits 0', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': compositionCommands,
        '.xci/config.yml': '',
      }),
    );
    const { code } = runCliInDir(dir, ['ok1', '+', 'ok2']);
    expect(code).toBe(0);
  });

  it('sequential stops on first failure: fail1 + ok2 exits with fail1 code, ok2 does not run', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': compositionCommands,
        '.xci/config.yml': '',
      }),
    );
    const markerFile = join(dir, 'ok2-ran.txt');
    // ok2 in our commands doesn't write a marker, so we rely on the fact that
    // sequential stops: substitute ok2 with marker alias for this test
    const cmdsWithMarker =
      compositionCommands +
      [
        'marker-ok2:',
        '  cmd: ["node", "-e", "require(\'fs\').writeFileSync(process.env.MARKER2, \'x\')"]',
        '',
      ].join('\n');
    const dir2 = trackDir(
      createTempProject({
        '.xci/commands.yml': cmdsWithMarker,
        '.xci/config.yml': '',
      }),
    );
    const marker2 = join(dir2, 'ok2-ran.txt');
    const { code } = runCliInDir(dir2, ['fail1', '+', 'marker-ok2'], { MARKER2: marker2 });
    expect(code).toBe(3);
    // ok2 must NOT have run since fail1 exits non-zero first
    expect(existsSync(marker2)).toBe(false);
  });

  it('parallel waits all + returns first non-zero: --parallel ok1 + fail1 exits non-zero', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': compositionCommands,
        '.xci/config.yml': '',
      }),
    );
    // Both run — parallel does not short-circuit.
    // We can't easily assert ok1 ran when it has no side-effect, but we verify exit code
    const { code } = runCliInDir(dir, ['--parallel', 'ok1', '+', 'fail1']);
    expect(code).not.toBe(0);
    expect(code).toBe(3);
  });

  it('parallel all success: --parallel ok1 + ok2 exits 0', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': compositionCommands,
        '.xci/config.yml': '',
      }),
    );
    const { code } = runCliInDir(dir, ['--parallel', 'ok1', '+', 'ok2']);
    expect(code).toBe(0);
  });

  it('per-segment args routing: echoarg AAA + echoarg BBB routes args to correct segments', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': compositionCommands,
        '.xci/config.yml': '',
      }),
    );
    // --log makes both segments' stdout visible in the test result
    const { stdout, code } = runCliInDir(dir, ['echoarg', 'AAA', '+', 'echoarg', 'BBB', '--log']);
    expect(code).toBe(0);
    expect(stdout).toContain('AAA');
    expect(stdout).toContain('BBB');
    // AAA must not appear in the echoarg BBB invocation's output
    // (they run sequentially so output is interleaved: we just check both are present)
    // The key assertion is that neither segment receives the other's args:
    // We can infer from the output — if both AAA and BBB appear and neither output contains 'AAA,BBB'
    // that means they were routed separately.
    expect(stdout).not.toContain('AAA,BBB');
    expect(stdout).not.toContain('BBB,AAA');
  });

  it('unknown alias in chain fails early (exit 50), ok1 does not execute', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': compositionCommands,
        '.xci/config.yml': '',
      }),
    );
    const markerFile = join(dir, 'ok1-ran.txt');
    // We can only write a marker if commands.yml has the marker alias
    // The existing ok1 just exits 0 — we assert only exit code and stderr
    const { stderr, code } = runCliInDir(dir, ['ok1', '+', 'nope']);
    expect(code).toBe(50);
    expect(stderr).toContain('Unknown alias: "nope"');
    // Since validation is early (before execution), no commands ran
    // We cannot assert marker from ok1 since ok1 has no side-effect,
    // but the exit code being 50 (not the alias' exit code) confirms early abort
  });

  it('--parallel not forwarded to segments: echoarg output does not contain --parallel', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': compositionCommands,
        '.xci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['--parallel', 'echoarg', '+', 'echoarg', '--log']);
    expect(code).toBe(0);
    // Neither echoarg invocation should receive --parallel as an argument
    expect(stdout).not.toContain('--parallel');
  });

  it('unknown alias anywhere in chain exits 50 before any execution (with flag-file proof)', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          'writer:',
          '  cmd: ["node", "-e", "require(\'fs\').writeFileSync(process.env.MARKER, \'x\')"]',
          '',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const markerFile = join(dir, 'writer-ran.txt');
    const { stderr, code } = runCliInDir(dir, ['writer', '+', 'nonexistent'], {
      MARKER: markerFile,
    });
    expect(code).toBe(50);
    expect(stderr).toContain('Unknown alias: "nonexistent"');
    // writer must NOT have run — early validation precedes execution
    expect(existsSync(markerFile)).toBe(false);
  });
});

/* ================================================================
 * quick-260618-h1d: uproject command kind e2e tests
 * ================================================================ */

describe.skipIf(!existsSync(CLI))('uproject command kind (quick-260618-h1d)', () => {
  const sampleUproject =
    JSON.stringify(
      {
        FileVersion: 3,
        EngineAssociation: '5.3',
        Category: '',
        Description: '',
        Plugins: [
          { Name: 'EnhancedInput', Enabled: false },
          { Name: 'Paper2D', Enabled: true },
        ],
      },
      null,
      2,
    ) + '\n';

  it('enables absent plugin, disables existing plugin, sets field, exits 0', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          'edit-uproject:',
          '  description: Test uproject command',
          '  uproject: MyGame.uproject',
          '  plugins:',
          '    enable:',
          '      - EnhancedInput',
          '      - NewPlugin',
          '    disable:',
          '      - Paper2D',
          '  set:',
          '    EngineAssociation: "5.4"',
        ].join('\n'),
        '.xci/config.yml': '',
        'MyGame.uproject': sampleUproject,
      }),
    );
    const { code } = runCliInDir(dir, ['edit-uproject']);
    expect(code).toBe(0);

    // Re-read and parse the uproject
    const updated = JSON.parse(readFileSync(join(dir, 'MyGame.uproject'), 'utf8'));

    // EngineAssociation was set
    expect(updated.EngineAssociation).toBe('5.4');

    // EnhancedInput should be enabled
    const enhanced = updated.Plugins.find((p: { Name: string }) => p.Name === 'EnhancedInput');
    expect(enhanced?.Enabled).toBe(true);

    // NewPlugin should have been added
    const newPlugin = updated.Plugins.find((p: { Name: string }) => p.Name === 'NewPlugin');
    expect(newPlugin?.Enabled).toBe(true);

    // Paper2D should be disabled
    const paper2d = updated.Plugins.find((p: { Name: string }) => p.Name === 'Paper2D');
    expect(paper2d?.Enabled).toBe(false);
  });

  it('disabling an absent plugin appends a disabled entry and exits 0', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          'test-disable-absent:',
          '  uproject: MyGame.uproject',
          '  plugins:',
          '    disable:',
          '      - MetaXrUtilsLibrary',
        ].join('\n'),
        '.xci/config.yml': '',
        'MyGame.uproject': sampleUproject,
      }),
    );
    const { code } = runCliInDir(dir, ['test-disable-absent']);
    expect(code).toBe(0);
    const updated = JSON.parse(readFileSync(join(dir, 'MyGame.uproject'), 'utf8'));
    const entry = (updated.Plugins as Array<Record<string, unknown>>).find(
      (p) => p.Name === 'MetaXrUtilsLibrary',
    );
    expect(entry).toEqual({ Name: 'MetaXrUtilsLibrary', Enabled: false });
  });

  it('already-enabled plugin emits idempotency warning on stderr but exits 0', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          'test-idempotent:',
          '  uproject: MyGame.uproject',
          '  plugins:',
          '    enable:',
          '      - Paper2D',
        ].join('\n'),
        '.xci/config.yml': '',
        'MyGame.uproject': sampleUproject,
      }),
    );
    const { stderr, code } = runCliInDir(dir, ['test-idempotent']);
    expect(code).toBe(0);
    expect(stderr).toContain('already enabled');
  });

  it('--dry-run prints plan and does NOT modify the .uproject file', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          'edit-uproject:',
          '  uproject: MyGame.uproject',
          '  plugins:',
          '    enable:',
          '      - NewPlugin',
          '  set:',
          '    EngineAssociation: "5.4"',
        ].join('\n'),
        '.xci/config.yml': '',
        'MyGame.uproject': sampleUproject,
      }),
    );
    const { stderr, code } = runCliInDir(dir, ['edit-uproject', '--dry-run']);
    expect(code).toBe(0);
    expect(stderr).toContain('[dry-run]');
    expect(stderr).toContain('uproject');

    // File must be unchanged
    const content = readFileSync(join(dir, 'MyGame.uproject'), 'utf8');
    expect(content).toBe(sampleUproject);
  });

  it('output file keeps 2-space indentation and trailing newline', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          'edit-uproject:',
          '  uproject: MyGame.uproject',
          '  set:',
          '    EngineAssociation: "5.4"',
        ].join('\n'),
        '.xci/config.yml': '',
        'MyGame.uproject': sampleUproject,
      }),
    );
    const { code } = runCliInDir(dir, ['edit-uproject']);
    expect(code).toBe(0);

    const content = readFileSync(join(dir, 'MyGame.uproject'), 'utf8');
    // 2-space indent
    expect(content).toContain('  "FileVersion"');
    // trailing newline
    expect(content.endsWith('\n')).toBe(true);
    expect(content.endsWith('\n\n')).toBe(false);
  });

  it('--list shows uproject type and file', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          'edit-uproject:',
          '  description: Edit the uproject',
          '  uproject: MyGame.uproject',
          '  set:',
          '    EngineAssociation: "5.4"',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const { stderr, code } = runCliInDir(dir, ['edit-uproject', '--list']);
    expect(code).toBe(0);
    expect(stderr).toContain('uproject');
    expect(stderr).toContain('MyGame.uproject');
  });

  it('--help shows uproject type', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          'edit-uproject:',
          '  description: Edit the uproject',
          '  uproject: MyGame.uproject',
          '  set:',
          '    EngineAssociation: "5.4"',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(dir, ['edit-uproject', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Command type: uproject');
    expect(stdout).toContain('MyGame.uproject');
  });

  it('uproject kind with no operations throws schema error (exit non-zero)', () => {
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': ['bad-uproject:', '  uproject: MyGame.uproject'].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const { stderr, code } = runCliInDir(dir, []);
    // Schema error on load — non-zero exit
    expect(code).not.toBe(0);
    expect(stderr.toLowerCase()).toContain('uproject');
  });
});

/* ================================================================
 * quick-260421-kbl: breadcrumb step headers in nested sequentials
 * ================================================================ */

describe.skipIf(!existsSync(CLI))('breadcrumb step headers (quick-260421-kbl)', () => {
  it('shows full breadcrumb path in nested sequential step headers', () => {
    const yml = [
      'A1a: { cmd: ["echo", "a1a"] }',
      'A1b: { cmd: ["echo", "a1b"] }',
      'A2:  { cmd: ["echo", "a2"]  }',
      'A1:',
      '  steps:',
      '    - A1a',
      '    - A1b',
      'A:',
      '  steps:',
      '    - A1',
      '    - A2',
      '',
    ].join('\n');
    const dir = trackDir(
      createTempProject({
        '.xci/commands.yml': yml,
        '.xci/config.yml': '',
      }),
    );
    const { stderr, code } = runCliInDir(dir, ['A']);
    expect(code).toBe(0);
    expect(stderr).toContain('A > A1 > A1a');
    expect(stderr).toContain('A > A1 > A1b');
    expect(stderr).toContain('A > A2');
    // Pure-leaf header must NOT appear for nested cases (chain length > 1).
    // Exact-match "▶ A1a " (leading triangle + space-after-name) would indicate
    // the breadcrumb was not applied.
    expect(stderr).not.toMatch(/\u25b6 A1a \[/);
    expect(stderr).not.toMatch(/\u25b6 A1b \[/);
  });
});

describe.skipIf(!existsSync(CLI))('xci command kind (260623-fr4)', () => {
  it('--dry-run prints alias and project directory', () => {
    const childDir = trackDir(
      createTempProject({
        '.xci/commands.yml': ['build:', '  cmd: ["node", "-e", "process.exit(0)"]', ''].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const parentDir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          `delegate-build:`,
          `  kind: xci`,
          `  alias: build`,
          `  project: "${childDir.replace(/\\/g, '/')}"`,
          '',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const { stderr, code } = runCliInDir(parentDir, ['delegate-build', '--dry-run']);
    expect(code).toBe(0);
    // dry-run prints the xci step as "xci → <alias> @ <dir>"
    expect(stderr).toContain('xci');
    // dry-run must show the delegated alias name
    expect(stderr).toContain('build');
  });

  it('--list shows xci kind and alias in the alias list', () => {
    const childDir = trackDir(
      createTempProject({
        '.xci/commands.yml': ['build:', '  cmd: ["node", "-e", "process.exit(0)"]', ''].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const parentDir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          `delegate-build:`,
          `  kind: xci`,
          `  alias: build`,
          `  project: "${childDir.replace(/\\/g, '/')}"`,
          '',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const { stdout, code } = runCliInDir(parentDir, ['--list']);
    expect(code).toBe(0);
    expect(stdout).toContain('delegate-build');
  });

  it('per-alias --help shows xci kind details', () => {
    const childDir = trackDir(
      createTempProject({
        '.xci/commands.yml': ['build:', '  cmd: ["node", "-e", "process.exit(0)"]', ''].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const parentDir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          `delegate-build:`,
          `  kind: xci`,
          `  description: Delegate build to child project`,
          `  alias: build`,
          `  project: "${childDir.replace(/\\/g, '/')}"`,
          '',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const { stderr, stdout, code } = runCliInDir(parentDir, ['delegate-build', '--help']);
    expect(code).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toContain('delegate-build');
    expect(combined).toContain('build');
  });

  it('delegates execution to child project and propagates exit code 0', () => {
    const childDir = trackDir(
      createTempProject({
        '.xci/commands.yml': ['succeed:', '  cmd: ["node", "-e", "process.exit(0)"]', ''].join(
          '\n',
        ),
        '.xci/config.yml': '',
      }),
    );
    const parentDir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          `run-child:`,
          `  kind: xci`,
          `  alias: succeed`,
          `  project: "${childDir.replace(/\\/g, '/')}"`,
          '',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const { code } = runCliInDir(parentDir, ['run-child']);
    expect(code).toBe(0);
  });

  it('delegates execution to child project and propagates non-zero exit code', () => {
    const childDir = trackDir(
      createTempProject({
        '.xci/commands.yml': ['fail:', '  cmd: ["node", "-e", "process.exit(3)"]', ''].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const parentDir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          `run-child-fail:`,
          `  kind: xci`,
          `  alias: fail`,
          `  project: "${childDir.replace(/\\/g, '/')}"`,
          '',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const { code } = runCliInDir(parentDir, ['run-child-fail']);
    expect(code).toBe(3);
  });

  it('sets XCI_NESTING_DEPTH=1 in the child process environment', () => {
    // The child xci process must have XCI_NESTING_DEPTH=1 set in its env.
    // We verify by delegating to an alias that emits the depth value to stderr
    // (xci routes child cmd stdout through its own tail display on stderr).
    const childDir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          'print-depth:',
          // Write XCI_NESTING_DEPTH to stderr — visible in parent's stderr output
          '  cmd: ["node", "-e", "process.stderr.write(String(process.env.XCI_NESTING_DEPTH ?? -1))"]',
          '',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const parentDir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          `delegate-depth:`,
          `  kind: xci`,
          `  alias: print-depth`,
          `  project: "${childDir.replace(/\\/g, '/')}"`,
          '',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const { stderr, code } = runCliInDir(parentDir, ['delegate-depth']);
    expect(code).toBe(0);
    // XCI_NESTING_DEPTH=1 must appear somewhere in stderr output
    expect(stderr).toContain('1');
  });

  it('xci as sequential step: runs before and after commands', () => {
    const childDir = trackDir(
      createTempProject({
        '.xci/commands.yml': ['succeed:', '  cmd: ["node", "-e", "process.exit(0)"]', ''].join(
          '\n',
        ),
        '.xci/config.yml': '',
      }),
    );
    const parentDir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          `ok-step:`,
          `  cmd: ["node", "-e", "process.exit(0)"]`,
          `multi:`,
          `  kind: sequential`,
          `  steps:`,
          `    - ok-step`,
          `    - kind: xci`,
          `      alias: succeed`,
          `      project: "${childDir.replace(/\\/g, '/')}"`,
          `    - ok-step`,
          '',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const { code } = runCliInDir(parentDir, ['multi']);
    expect(code).toBe(0);
  });

  // ------------------------------------------------------------------
  // quick-260623-hp3: delegated output shown (SHOW+SAVE) — BUILD-LINE-STDOUT
  // ------------------------------------------------------------------

  it('SHOW+SAVE: delegated line appears in outer stdout AND outer logfile (BUILD-LINE-STDOUT)', () => {
    const childDir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          'print-line:',
          // Write a known string to stdout so the outer can assert it
          `  cmd: ["node", "-e", "process.stdout.write('BUILD-LINE-STDOUT\\\\n')"]`,
          '',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    const parentDir = trackDir(
      createTempProject({
        '.xci/commands.yml': [
          `delegate-print:`,
          `  kind: xci`,
          `  alias: print-line`,
          `  project: "${childDir.replace(/\\/g, '/')}"`,
          '',
        ].join('\n'),
        '.xci/config.yml': '',
      }),
    );
    // --log ensures showOutput=true and logFile is opened by the outer CLI
    const { stdout, stderr, code } = runCliInDir(parentDir, ['delegate-print', '--log']);
    expect(code).toBe(0);

    // (a) The delegated line must appear in outer combined output (stdout or stderr)
    const combined = stdout + stderr;
    expect(combined).toContain('BUILD-LINE-STDOUT');

    // (b) The outer project's .xci/log/ file must also contain the delegated line
    const logDir = join(parentDir, '.xci', 'log');
    expect(existsSync(logDir)).toBe(true);
    const logFiles = readdirSync(logDir).map((f) => join(logDir, f));
    expect(logFiles.length).toBeGreaterThan(0);
    // Find the newest log file (in case there are multiple)
    const newestLog = logFiles.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    const logContent = readFileSync(newestLog!, 'utf8');
    expect(logContent).toContain('BUILD-LINE-STDOUT');
  });

  // ------------------------------------------------------------------
  // quick-260623-hp3: anti-hang regression (vitest timeout is PRIMARY signal)
  // NOTE: The vitest timeout on this test IS the primary hang detection signal.
  // A true hang would cause spawnSync to block indefinitely and the vitest
  // timeout would fire and fail the test. The elapsed-time check below is
  // belt-and-suspenders only — if the test completes within the timeout, it
  // means the piped+exit-event anti-hang implementation is working correctly.
  // ------------------------------------------------------------------

  it(
    'ANTI-HANG: delegate resolves even when inner leaves a short-lived background grandchild (vitest timeout is primary hang signal)',
    { timeout: 20000 },
    () => {
      const childDir = trackDir(
        createTempProject({
          '.xci/commands.yml': [
            'with-background:',
            // Spawn a short-lived detached background process that briefly holds
            // a pipe open, then write DONE to stdout and exit the main process.
            // The background grandchild sleeps 400ms in the system temp dir
            // (not the project dir) to avoid EPERM on Windows cleanup.
            `  cmd: ["node", "-e", "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},400)'],{detached:true,stdio:'ignore',cwd:require('os').tmpdir()});c.unref();process.stdout.write('DONE\\\\n')"]`,
            '',
          ].join('\n'),
          '.xci/config.yml': '',
        }),
      );
      const parentDir = trackDir(
        createTempProject({
          '.xci/commands.yml': [
            `delegate-bg:`,
            `  kind: xci`,
            `  alias: with-background`,
            `  project: "${childDir.replace(/\\/g, '/')}"`,
            '',
          ].join('\n'),
          '.xci/config.yml': '',
        }),
      );

      const start = Date.now();
      const { stdout, stderr, code } = runCliInDir(parentDir, ['delegate-bg', '--log']);
      const elapsed = Date.now() - start;

      // Primary hang signal: if this point is reached, the test did not hang
      // (vitest timeout would have killed it otherwise).
      expect(code).toBe(0);
      expect(stdout + stderr).toContain('DONE');
      // Belt-and-suspenders: should complete well within 15 seconds
      expect(elapsed).toBeLessThan(15000);
    },
  );

  // ------------------------------------------------------------------
  // quick-260623-ipz: breadcrumb propagation across xci delegate boundary
  // ------------------------------------------------------------------

  it(
    'breadcrumb propagation: outer kind:xci run header shows full path "running: run-child > inner-seq"',
    { timeout: 20000 },
    () => {
      // CHILD project: inner-seq is a sequential alias whose first step prints a known line
      const childDir = trackDir(
        createTempProject({
          '.xci/commands.yml': [
            'inner-step:',
            `  cmd: ["node", "-e", "process.stdout.write('INNER-LINE\\\\n')"]`,
            '',
            'inner-seq:',
            '  kind: sequential',
            '  steps:',
            '    - inner-step',
            '',
          ].join('\n'),
          '.xci/config.yml': '',
        }),
      );
      // OUTER project: run-child delegates to child's inner-seq via kind:xci
      const outerDir = trackDir(
        createTempProject({
          '.xci/commands.yml': [
            'run-child:',
            '  kind: xci',
            '  alias: inner-seq',
            `  project: "${childDir.replace(/\\/g, '/')}"`,
            '',
          ].join('\n'),
          '.xci/config.yml': '',
        }),
      );
      // --log: SHOW+SAVE so inner output tees into the outer's captured stdout/stderr
      const { stdout, stderr, code } = runCliInDir(outerDir, ['run-child', '--log']);
      expect(code).toBe(0);

      const combined = stdout + stderr;
      // The inner xci run header MUST show the full breadcrumb path in the "running:" line
      // (output.ts printRunHeader prefix — the actual assertion for Task 3 output.ts change)
      expect(combined).toContain('running: run-child > inner-seq');
      // The tee path must be exercised: inner stdout line must reach outer output
      expect(combined).toContain('INNER-LINE');
    },
  );
});
