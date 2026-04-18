// packages/xci/src/agent/index.ts
// Agent module stub entry point — lazy-loaded from cli.ts when --agent is in argv.
// Full implementation lands in Plan 08-04.

import type { AgentFrame } from './types.js'; // keep the import so the types entry is referenced

void ({} as AgentFrame | undefined);

export async function runAgent(_argv: readonly string[]): Promise<number> {
  process.stderr.write('[agent] stub — daemon not yet implemented (lands in 08-04)\n');
  return 0;
}
