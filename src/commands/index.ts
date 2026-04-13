// src/commands/index.ts
//
// commands.yml loader — Phase 3 implementation.
// Reads .loci/commands.yml, normalizes all alias shapes, validates the graph,
// and returns a typed CommandMap ready for the resolver.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, YAMLParseError as YamlLibError } from 'yaml';
import { YamlParseError } from '../errors.js';
import type { CommandMap, CommandsLoader } from '../types.js';
import { normalizeCommands } from './normalize.js';
import { validateGraph } from './validate.js';

// ---------------------------------------------------------------------------
// Internal YAML reader
// ---------------------------------------------------------------------------

/**
 * Read and parse .loci/commands.yml in the given working directory.
 *
 * Returns null if the file does not exist (ENOENT).
 * Throws YamlParseError for malformed YAML or non-mapping root.
 */
function readCommandsYaml(cwd: string): Record<string, unknown> | null {
  const filePath = join(cwd, '.loci', 'commands.yml');

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return null;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (err: unknown) {
    if (err instanceof YamlLibError) {
      throw new YamlParseError(filePath, err.linePos?.[0]?.line, err);
    }
    throw err;
  }

  // Empty file or null document → empty commands map
  if (parsed === null || parsed === undefined) {
    return null;
  }

  // Root document must be a YAML mapping (object)
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new YamlParseError(
      filePath,
      undefined,
      new Error('Root document must be a YAML mapping'),
    );
  }

  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// CommandsLoader export
// ---------------------------------------------------------------------------

export const commandsLoader: CommandsLoader = {
  async load(cwd: string): Promise<CommandMap> {
    const filePath = join(cwd, '.loci', 'commands.yml');
    const raw = readCommandsYaml(cwd);
    if (raw === null) return new Map();
    const commands = normalizeCommands(raw, filePath);
    validateGraph(commands);
    return commands;
  },
};
