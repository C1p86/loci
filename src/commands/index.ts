// src/commands/index.ts
//
// Phase 3 stub. Throws NotImplementedError per D-06.

import { NotImplementedError } from '../errors.js';
import type { CommandMap, CommandsLoader } from '../types.js';

export const commandsLoader: CommandsLoader = {
  async load(_cwd: string): Promise<CommandMap> {
    throw new NotImplementedError('CommandsLoader (Phase 3)');
  },
};
