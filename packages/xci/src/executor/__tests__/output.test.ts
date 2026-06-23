// src/executor/__tests__/output.test.ts

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANSI_PALETTE,
  BRIGHT_CYAN,
  dimPrefix,
  formatError,
  formatPrefix,
  formatWarning,
  hashColor,
  makeLineTransform,
  printDelegationBanner,
  printDryRun,
  printParallelSummary,
  printRunHeader,
  printStepHeader,
  printStepPreview,
  shouldUseColor,
} from '../output.js';
import type { CommandDef, ExecutionPlan } from '../../types.js';

describe('hashColor', () => {
  it('returns the same color for the same alias name across calls', () => {
    expect(hashColor('api')).toBe(hashColor('api'));
    expect(hashColor('deploy')).toBe(hashColor('deploy'));
  });

  it('returns a string from ANSI_PALETTE', () => {
    const color = hashColor('someAlias');
    expect(ANSI_PALETTE).toContain(color);
  });

  it('produces different colors for different names (most of the time)', () => {
    // Not guaranteed, but with 8 colors and distinct names, very unlikely to collide
    const colors = new Set(
      ['api', 'build', 'deploy', 'test', 'lint', 'format', 'package', 'run'].map(hashColor),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('shouldUseColor', () => {
  it('returns false when NO_COLOR is set', () => {
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string);
    expect(shouldUseColor()).toBe(false);
  });

  it('returns true when FORCE_COLOR is set and NO_COLOR is not set', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');
    expect(shouldUseColor()).toBe(true);
  });

  it('NO_COLOR takes precedence over FORCE_COLOR', () => {
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('FORCE_COLOR', '1');
    expect(shouldUseColor()).toBe(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});

describe('formatPrefix', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns bracket format [alias] when color is disabled', () => {
    vi.stubEnv('NO_COLOR', '1');
    expect(formatPrefix('api')).toBe('[api]');
  });

  it('returns ANSI-wrapped alias name when color is enabled', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');
    const result = formatPrefix('api');
    expect(result).toContain('api');
    expect(result).toMatch(/\x1b\[/); // contains ANSI escape
    expect(result).toContain('\x1b[0m'); // contains RESET
  });
});

describe('dimPrefix', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns [label] without color', () => {
    vi.stubEnv('NO_COLOR', '1');
    expect(dimPrefix('dry-run')).toBe('[dry-run]');
  });

  it('returns dim-wrapped [label] with color', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');
    const result = dimPrefix('verbose');
    expect(result).toContain('[verbose]');
    expect(result).toContain('\x1b[2m'); // DIM
    expect(result).toContain('\x1b[0m'); // RESET
  });
});

describe('makeLineTransform', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('generator yields a prefixed line', () => {
    vi.stubEnv('NO_COLOR', '1');
    const transform = makeLineTransform('api');
    const gen = transform('hello world');
    const result = gen.next();
    expect(result.value).toBe('[api] hello world');
    expect(result.done).toBe(false);
    expect(gen.next().done).toBe(true);
  });

  it('uses ANSI prefix when color is enabled', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');
    const transform = makeLineTransform('api');
    const gen = transform('some output');
    const result = gen.next();
    expect(result.value).toContain('api');
    expect(result.value).toContain('some output');
    expect(result.value).toMatch(/\x1b\[/);
  });
});

describe('printStepHeader', () => {
  it('writes ▶ name\\n to stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    printStepHeader('build');
    expect(stderrSpy).toHaveBeenCalledWith('\u25b6 build\n');
    stderrSpy.mockRestore();
  });
});

describe('printDryRun', () => {
  let stderrOutput: string[];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrOutput = [];
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput.push(String(chunk));
      return true;
    });
    vi.stubEnv('NO_COLOR', '1');
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('writes correct format for single plan', () => {
    printDryRun({ kind: 'single', argv: ['node', '-e', 'console.log(1)'] }, new Set());
    const output = stderrOutput.join('');
    expect(output).toContain('[dry-run]');
    expect(output).toContain('single:');
    expect(output).toContain('node');
    expect(output).toContain('console.log(1)');
  });

  it('redacts secret values in single argv', () => {
    printDryRun(
      { kind: 'single', argv: ['deploy', '--token', 'supersecret'] },
      new Set(['supersecret']),
    );
    const output = stderrOutput.join('');
    expect(output).not.toContain('supersecret');
    expect(output).toContain('***');
  });

  it('writes correct format for sequential plan', () => {
    printDryRun(
      {
        kind: 'sequential',
        steps: [{ argv: ['npm', 'run', 'build'] }, { argv: ['npm', 'test'] }],
      },
      new Set(),
    );
    const output = stderrOutput.join('');
    expect(output).toContain('[dry-run]');
    expect(output).toContain('sequential');
    expect(output).toContain('2 steps');
    expect(output).toContain('npm');
    expect(output).toContain('1.');
    expect(output).toContain('2.');
  });

  it('writes correct format for parallel plan', () => {
    printDryRun(
      {
        kind: 'parallel',
        failMode: 'fast',
        group: [
          { alias: 'api', argv: ['node', 'api.js'] },
          { alias: 'worker', argv: ['node', 'worker.js'] },
        ],
      },
      new Set(),
    );
    const output = stderrOutput.join('');
    expect(output).toContain('[dry-run]');
    expect(output).toContain('parallel');
    expect(output).toContain('failMode: fast');
    expect(output).toContain('[api]');
    expect(output).toContain('[worker]');
  });
});

describe('printParallelSummary', () => {
  let stderrOutput: string[];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrOutput = [];
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput.push(String(chunk));
      return true;
    });
    vi.stubEnv('NO_COLOR', '1');
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('writes checkmark for exit 0', () => {
    printParallelSummary([{ alias: 'api' }], [{ exitCode: 0, canceled: false }]);
    const output = stderrOutput.join('');
    expect(output).toContain('\u2713');
    expect(output).toContain('api');
    expect(output).toContain('exit 0');
  });

  it('writes cross for non-zero exit', () => {
    printParallelSummary([{ alias: 'worker' }], [{ exitCode: 1, canceled: false }]);
    const output = stderrOutput.join('');
    expect(output).toContain('\u2717');
    expect(output).toContain('worker');
    expect(output).toContain('exit 1');
  });

  it('shows canceled status', () => {
    printParallelSummary([{ alias: 'slow' }], [{ exitCode: 0, canceled: true }]);
    const output = stderrOutput.join('');
    expect(output).toContain('canceled');
  });

  it('handles multiple entries', () => {
    printParallelSummary(
      [{ alias: 'api' }, { alias: 'worker' }],
      [
        { exitCode: 0, canceled: false },
        { exitCode: 2, canceled: false },
      ],
    );
    const output = stderrOutput.join('');
    expect(output).toContain('api');
    expect(output).toContain('worker');
    expect(output).toContain('\u2713'); // check for api
    expect(output).toContain('\u2717'); // cross for worker
  });
});

describe('formatWarning', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('wraps message in YELLOW when color is enabled', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');
    const result = formatWarning('something went wrong');
    expect(result.startsWith('\x1b[33m')).toBe(true);
    expect(result.endsWith('\x1b[0m')).toBe(true);
    expect(result).toContain('something went wrong');
  });

  it('returns the input unchanged when color is disabled', () => {
    vi.stubEnv('NO_COLOR', '1');
    expect(formatWarning('something went wrong')).toBe('something went wrong');
  });
});

describe('formatError', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('wraps message in RED when color is enabled', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');
    const result = formatError('boom');
    expect(result.startsWith('\x1b[31m')).toBe(true);
    expect(result.endsWith('\x1b[0m')).toBe(true);
    expect(result).toContain('boom');
  });

  it('returns the input unchanged when color is disabled', () => {
    vi.stubEnv('NO_COLOR', '1');
    expect(formatError('boom')).toBe('boom');
  });
});

describe('printStepHeader color', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('wraps the header in BOLD + CYAN when FORCE_COLOR is set', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      printStepHeader('build');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const written = String(stderrSpy.mock.calls[0]?.[0] ?? '');
      expect(written).toContain('\x1b[1m'); // BOLD
      expect(written).toContain('\x1b[36m'); // CYAN
      expect(written).toContain('build');
      expect(written).toContain('\x1b[0m'); // RESET
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe('printRunHeader', () => {
  let stderrOutput: string[];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrOutput = [];
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput.push(String(chunk));
      return true;
    });
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('prints title, referenced variables (secrets masked), and single-step plan', () => {
    const def: CommandDef = {
      kind: 'single',
      cmd: ['curl', '-H', '${api.token}', '${api.url}'],
    };
    const plan: ExecutionPlan = {
      kind: 'single',
      argv: ['curl', '-H', 's3cr3tValue42', 'https://api.example.com'],
    };
    const effectiveValues = {
      'api.token': 's3cr3tValue42',
      'api.url': 'https://api.example.com',
      'unused.var': 'ignore-me',
    };
    const secretKeys = new Set(['api.token']);

    printRunHeader('deploy', def, plan, effectiveValues, secretKeys);

    const output = stderrOutput.join('');
    expect(output).toContain('running: deploy');
    expect(output).toContain('variables:');
    expect(output).toContain('api.token');
    expect(output).toContain('**********');
    expect(output).toContain('api.url');
    expect(output).toContain('https://api.example.com');
    // unreferenced vars must NOT appear
    expect(output).not.toContain('unused.var');
    expect(output).not.toContain('ignore-me');
    // secret value must NEVER appear
    expect(output).not.toContain('s3cr3tValue42');
    // steps block — secret token in argv is redacted to ***
    expect(output).toContain('steps:');
    expect(output).toContain('curl');
    expect(output).toContain('***');
  });

  it('redacts a standalone secret token in the steps block', () => {
    const def: CommandDef = {
      kind: 'single',
      cmd: ['deploy', '--token', '${api.token}'],
    };
    const plan: ExecutionPlan = {
      kind: 'single',
      argv: ['deploy', '--token', 's3cr3t'],
    };
    const effectiveValues = { 'api.token': 's3cr3t' };
    const secretKeys = new Set(['api.token']);

    printRunHeader('deploy', def, plan, effectiveValues, secretKeys);

    const output = stderrOutput.join('');
    expect(output).toContain('deploy --token ***');
    expect(output).not.toContain('s3cr3t');
  });

  it('numbers sequential steps and annotates capture', () => {
    const def: CommandDef = {
      kind: 'sequential',
      steps: ['build', 'test', 'deploy'],
    };
    const plan: ExecutionPlan = {
      kind: 'sequential',
      steps: [
        { argv: ['npm', 'run', 'build'] },
        { argv: ['npm', 'test'] },
        { argv: ['./deploy.sh'], capture: { var: 'result' } },
      ],
    };

    printRunHeader('ci', def, plan, {}, new Set());

    const output = stderrOutput.join('');
    expect(output).toContain('running: ci');
    expect(output).toContain('steps:');
    expect(output).toMatch(/1\.\s+npm run build/);
    expect(output).toMatch(/2\.\s+npm test/);
    expect(output).toMatch(/3\.\s+\.\/deploy\.sh \[capture → result\]/);
    // step refs in def.steps are alias names, no ${}: no variables block
    expect(output).not.toContain('variables:');
  });

  it('prints parallel plan entries with [alias] prefixes', () => {
    const def: CommandDef = {
      kind: 'parallel',
      group: ['api', 'worker'],
    };
    const plan: ExecutionPlan = {
      kind: 'parallel',
      failMode: 'fast',
      group: [
        { alias: 'api', argv: ['node', 'api.js'] },
        { alias: 'worker', argv: ['node', 'worker.js'] },
      ],
    };

    printRunHeader('services', def, plan, {}, new Set());

    const output = stderrOutput.join('');
    expect(output).toContain('running: services');
    expect(output).toContain('[api] node api.js');
    expect(output).toContain('[worker] node worker.js');
  });

  it('omits the variables block when the alias references no placeholders', () => {
    const def: CommandDef = { kind: 'single', cmd: ['ls', '-la'] };
    const plan: ExecutionPlan = { kind: 'single', argv: ['ls', '-la'] };
    const effectiveValues = { foo: 'bar', baz: 'qux' };

    printRunHeader('list', def, plan, effectiveValues, new Set());

    const output = stderrOutput.join('');
    expect(output).toContain('running: list');
    expect(output).not.toContain('variables:');
    // values present in the effective map but never referenced must be omitted
    expect(output).not.toContain('foo');
    expect(output).not.toContain('bar');
  });

  it('always prints the top-level cwd line when plan.cwd is set (quick-260422-pnv)', () => {
    const def: CommandDef = { kind: 'single', cmd: ['echo', 'hi'] };
    const plan: ExecutionPlan = { kind: 'single', argv: ['echo', 'hi'], cwd: '/project/root' };

    printRunHeader('greet', def, plan, {}, new Set());

    const output = stderrOutput.join('');
    expect(output).toContain('cwd: /project/root');
  });

  it('wraps the title in BOLD + CYAN when FORCE_COLOR is set', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');
    // reset capture buffer since beforeEach stubbed NO_COLOR=1 and populated nothing yet
    stderrOutput.length = 0;

    const def: CommandDef = { kind: 'single', cmd: ['echo', 'hi'] };
    const plan: ExecutionPlan = { kind: 'single', argv: ['echo', 'hi'] };

    printRunHeader('greet', def, plan, {}, new Set());

    // First stderr chunk is the title
    const firstChunk = stderrOutput[0] ?? '';
    expect(firstChunk).toContain('\x1b[1m'); // BOLD
    expect(firstChunk).toContain('\x1b[36m'); // CYAN
    expect(firstChunk).toContain('running: greet');
    expect(firstChunk).toContain('\x1b[0m'); // RESET
  });
});

describe('printDelegationBanner', () => {
  let chunks: string[];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    chunks = [];
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('color ON: separator line contains BRIGHT_CYAN (\\x1b[96m) and RESET', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');

    printDelegationBanner('packages/backend', 'build', [], new Set());

    const output = chunks.join('');
    expect(output).toContain('\x1b[96m'); // BRIGHT_CYAN
    expect(output).toContain('\x1b[0m'); // RESET
  });

  it('color ON: output contains project, alias, and args', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');

    printDelegationBanner('packages/backend', 'build', ['--watch', '--prod'], new Set());

    const output = chunks.join('');
    expect(output).toContain('packages/backend');
    expect(output).toContain('build');
    expect(output).toContain('--watch');
    expect(output).toContain('--prod');
  });

  it('color OFF: no ANSI escape codes anywhere in output', () => {
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string);

    printDelegationBanner('packages/backend', 'build', ['--watch'], new Set());

    const output = chunks.join('');
    expect(output).not.toContain('\x1b[');
    expect(output).toContain('packages/backend');
    expect(output).toContain('build');
    expect(output).toContain('--watch');
  });

  it('secret redaction: secret arg renders *** and cleartext is absent', () => {
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string);

    const secretValues = new Set(['s3cr3t']);
    printDelegationBanner('packages/backend', 'deploy', ['--token', 's3cr3t'], secretValues);

    const output = chunks.join('');
    expect(output).toContain('***');
    expect(output).not.toContain('s3cr3t');
  });

  it('empty args (empty array): params line reads "params: (none)"', () => {
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string);

    printDelegationBanner('packages/backend', 'build', [], new Set());

    const output = chunks.join('');
    expect(output).toContain('params: (none)');
  });

  it('undefined args: params line reads "params: (none)"', () => {
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string);

    printDelegationBanner('packages/backend', 'build', undefined, new Set());

    const output = chunks.join('');
    expect(output).toContain('params: (none)');
  });

  it('BRIGHT_CYAN constant equals \\x1b[96m', () => {
    expect(BRIGHT_CYAN).toBe('\x1b[96m');
  });

  it('writes three lines to stderr (separator, target, params)', () => {
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string);

    printDelegationBanner('packages/backend', 'build', ['arg1'], new Set());

    // Each write call ends with \n; we should have exactly 3 writes
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toMatch(/^-+\n$/); // separator line
    expect(chunks[1]).toContain('↳ xci → packages/backend :: build'); // ↳ xci → ...
    expect(chunks[2]).toContain('params: arg1');
  });
});

describe('printStepPreview — cwd preview', () => {
  let captured: string[];
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let tmpDir: string | undefined;

  beforeEach(() => {
    captured = [];
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      captured.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write);
    tmpDir = undefined;
  });

  afterEach(() => {
    writeSpy.mockRestore();
    vi.unstubAllEnvs();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it('emits yellow cwd line on stderr before run: line when FORCE_COLOR=1 and cwd is set', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');

    printStepPreview(undefined, ['echo', 'hi'], undefined, { cwd: '/abs/dir' });

    const joined = captured.join('');
    expect(joined).toContain('\x1b[33m  cwd: /abs/dir\x1b[0m');
    expect(joined.indexOf('cwd:')).toBeLessThan(joined.indexOf('run:'));
  });

  it('prints cwd and run even when verbose is false (quick-260422-qxy)', () => {
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string);

    printStepPreview(undefined, ['echo', 'hi'], undefined, {
      cwd: '/abs/dir',
      verbose: false,
    });

    const joined = captured.join('');
    expect(joined).toContain('  cwd: /abs/dir\n');
    expect(joined).toContain('  run: echo hi\n');
  });

  it('does NOT print cwd line when cwd option is omitted', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');

    printStepPreview(undefined, ['echo', 'hi'], undefined, {});

    const joined = captured.join('');
    expect(joined).not.toContain('cwd:');
  });

  it('emits plain cwd line (no ANSI) when NO_COLOR=1 and cwd is set', () => {
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string);
    vi.stubEnv('NO_COLOR', '1');

    printStepPreview(undefined, ['echo', 'hi'], undefined, { cwd: '/abs/dir' });

    const joined = captured.join('');
    expect(joined).toContain('  cwd: /abs/dir\n');
    expect(joined).not.toContain('\x1b');
  });

  it('appends cwd line to logFile in plain text BEFORE run: line', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');

    tmpDir = mkdtempSync(pathJoin(tmpdir(), 'xci-nmx-'));
    const tmpFile = pathJoin(tmpDir, 'log.txt');

    printStepPreview(undefined, ['echo', 'hi'], undefined, { cwd: '/abs/dir', logFile: tmpFile });

    const fileContents = readFileSync(tmpFile, 'utf8');
    expect(fileContents).toContain('  cwd: /abs/dir\n');
    expect(fileContents).toContain('  run: echo hi\n');
    expect(fileContents.indexOf('cwd:')).toBeLessThan(fileContents.indexOf('run:'));
    expect(fileContents).not.toContain('\x1b');
  });

  it('orders cwd → raw → run on stderr when rawArgv differs from resolvedArgv', () => {
    vi.stubEnv('NO_COLOR', undefined as unknown as string);
    vi.stubEnv('FORCE_COLOR', '1');

    printStepPreview(['npm', 'run', '${TASK}'], ['npm', 'run', 'build'], undefined, {
      cwd: '/abs/dir',
    });

    const joined = captured.join('');
    expect(joined.indexOf('cwd:')).toBeGreaterThanOrEqual(0);
    expect(joined.indexOf('raw:')).toBeGreaterThanOrEqual(0);
    expect(joined.indexOf('run:')).toBeGreaterThanOrEqual(0);
    expect(joined.indexOf('cwd:')).toBeLessThan(joined.indexOf('raw:'));
    expect(joined.indexOf('raw:')).toBeLessThan(joined.indexOf('run:'));
  });
});

/* ------------------------------------------------------------------ */
/* quick-260623-k2w: substring secret redaction                        */
/* ------------------------------------------------------------------ */

describe('substring secret redaction', () => {
  let chunks: string[];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    chunks = [];
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write);
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('FORCE_COLOR', undefined as unknown as string);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('token=SECRET is redacted to token=*** (embedded secret not leaked)', () => {
    const secretValues = new Set(['s3cr3t-abc123']);
    printDelegationBanner('pkg/deploy', 'deploy', ['token=s3cr3t-abc123'], secretValues);
    const output = chunks.join('');
    expect(output).toContain('token=***');
    expect(output).not.toContain('s3cr3t-abc123');
  });

  it('standalone SECRET token is still fully redacted to *** (old whole-token behavior preserved)', () => {
    const secretValues = new Set(['s3cr3t']);
    printDelegationBanner('pkg/deploy', 'deploy', ['s3cr3t'], secretValues);
    const output = chunks.join('');
    expect(output).toContain('***');
    expect(output).not.toContain('s3cr3t');
  });

  it('secret in the MIDDLE of a token: pre-SECRET-post → pre-***-post', () => {
    const secretValues = new Set(['MYSECRET']);
    printDelegationBanner('pkg/deploy', 'deploy', ['pre-MYSECRET-post'], secretValues);
    const output = chunks.join('');
    expect(output).toContain('pre-***-post');
    expect(output).not.toContain('MYSECRET');
  });

  it('one token containing TWO different secrets: both replaced, neither cleartext present', () => {
    const secretValues = new Set(['S1val', 'S2val']);
    printDelegationBanner('pkg/deploy', 'deploy', ['a=S1val;b=S2val'], secretValues);
    const output = chunks.join('');
    expect(output).toContain('a=***;b=***');
    expect(output).not.toContain('S1val');
    expect(output).not.toContain('S2val');
  });

  it('overlapping secrets: longer redacted first so no fragment leaks (abc123xyz → ***)', () => {
    const secretValues = new Set(['abc123', 'abc123xyz']);
    // token: k=abc123xyz — the short secret is a prefix of the long one
    // if short is replaced first: k=***xyz (fragment "xyz" leaks)
    // if long is replaced first: k=*** (correct)
    printDelegationBanner('pkg/deploy', 'deploy', ['k=abc123xyz'], secretValues);
    const output = chunks.join('');
    expect(output).toContain('k=***');
    // fragment "xyz" must NOT appear after *** (i.e. not "k=***xyz")
    expect(output).not.toContain('***xyz');
    expect(output).not.toContain('abc123');
  });

  it('secret containing regex metacharacters is matched LITERALLY (not as regex)', () => {
    const secretValues = new Set(['a.b*c$']);
    // v=a.b*c$ contains metacharacters — must match literally
    printDelegationBanner('pkg/deploy', 'deploy', ['v=a.b*c$'], secretValues);
    const output = chunks.join('');
    expect(output).toContain('v=***');
    expect(output).not.toContain('a.b*c$');
  });

  it('token that regex-matches the pattern but is not literal match: unchanged', () => {
    const secretValues = new Set(['a.b*c$']);
    // "aXbYcZ" would match the regex /a.b*c$/ but is NOT a literal substring — must be unchanged
    printDelegationBanner('pkg/deploy', 'deploy', ['v=aXbYcZ'], secretValues);
    const output = chunks.join('');
    expect(output).toContain('v=aXbYcZ');
  });

  it('no-secret token unchanged (empty secret set → output identical to input)', () => {
    const secretValues = new Set<string>();
    printDelegationBanner('pkg/deploy', 'deploy', ['hello=world'], secretValues);
    const output = chunks.join('');
    expect(output).toContain('hello=world');
  });

  it('empty-string secret in the set never blanks everything (guard against empty-secret DoS)', () => {
    // buildSecretValues already excludes '' but the internal guard must also protect
    const secretValues = new Set(['', 'realsecret']);
    printDelegationBanner('pkg/deploy', 'deploy', ['hello'], secretValues);
    const output = chunks.join('');
    // 'hello' must remain unchanged — the empty-string secret must not blank it
    expect(output).toContain('hello');
  });

  it('replace ALL occurrences: SECRET-mid-SECRET → ***-mid-***', () => {
    const secretValues = new Set(['SECRET']);
    printDelegationBanner('pkg/deploy', 'deploy', ['SECRET-mid-SECRET'], secretValues);
    const output = chunks.join('');
    expect(output).toContain('***-mid-***');
    expect(output).not.toContain('SECRET');
  });

  it('cwd embedding a secret substring is redacted in dry-run output', () => {
    const plan: ExecutionPlan = {
      kind: 'single',
      argv: ['echo', 'hi'],
      cwd: '/home/s3cr3t-abc123/proj',
    };
    const secretValues = new Set(['s3cr3t-abc123']);
    printDryRun(plan, secretValues);
    const output = chunks.join('');
    expect(output).toContain('/home/***/proj');
    expect(output).not.toContain('s3cr3t-abc123');
  });

  it('undefined cwd in dry-run: no cwd line emitted (unchanged passthrough)', () => {
    const plan: ExecutionPlan = {
      kind: 'single',
      argv: ['echo', 'hi'],
    };
    const secretValues = new Set(['s3cr3t']);
    printDryRun(plan, secretValues);
    const output = chunks.join('');
    expect(output).not.toContain('cwd:');
  });
});
