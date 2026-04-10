// src/config/index.ts
//
// Phase 2 stub. Throws NotImplementedError per D-06.
// Phase 2's first task will replace the `load` implementation — no file creation needed,
// no import sites elsewhere need to change.

import { NotImplementedError } from '../errors.js';
import type { ConfigLoader, ResolvedConfig } from '../types.js';

export const configLoader: ConfigLoader = {
  async load(_cwd: string): Promise<ResolvedConfig> {
    throw new NotImplementedError('ConfigLoader (Phase 2)');
  },
};
