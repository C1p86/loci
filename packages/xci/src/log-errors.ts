// packages/xci/src/log-errors.ts
//
// Shared helper: extract /error/i lines from captured output and emit them to stderr.
// Consumed by both the local CLI (cli.ts, on exitCode !== 0 before askShowLog) and the
// agent daemon (agent/index.ts, inside handleDispatch.onExit when exit_code !== 0,
// before the result frame is sent).
//
// Contract (see 260420-lxj-PLAN.md):
// - No-op (zero stderr writes) on empty input OR when zero /error/i matches.
// - On >= 1 match: header, up to MAX_LINES matched lines, optional truncation footer,
//   closing separator — all to process.stderr.
// - Never mutates input, never re-redacts (data is already redacted upstream).
// - Zero runtime dependencies; pure synchronous JS, cold-start safe.

const MAX_LINES = 50;

export function printErrorLines(output: string, source?: string): void {
  if (output.length === 0) return;

  const lines = output.split(/\r?\n/);
  const matches = lines.filter((l) => /error/i.test(l));

  if (matches.length === 0) return;

  const suffix = source ? ` in ${source}` : '';
  process.stderr.write(`--- ${matches.length} error line(s)${suffix} ---\n`);

  for (const line of matches.slice(0, MAX_LINES)) {
    process.stderr.write(`${line}\n`);
  }

  if (matches.length > MAX_LINES) {
    process.stderr.write(`(+${matches.length - MAX_LINES} more — see full log)\n`);
  }

  process.stderr.write('---\n');
}
