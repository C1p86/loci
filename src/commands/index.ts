// src/commands/index.ts
//
// commands.yml loader — Phase 3 implementation.
// Reads .xci/commands.yml, normalizes all alias shapes, validates the graph,
// and returns a typed CommandMap ready for the resolver.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse, YAMLParseError as YamlLibError } from 'yaml';
import { resolveMachineConfigDir } from '../config/index.js';
import { CommandSchemaError, YamlParseError } from '../errors.js';
import type { CommandDef, CommandMap, CommandsLoader } from '../types.js';
import { normalizeCommands } from './normalize.js';
import { validateGraph } from './validate.js';

// ---------------------------------------------------------------------------
// Internal YAML reader
// ---------------------------------------------------------------------------

/**
 * Read and parse a single YAML commands file.
 *
 * Returns null if the file does not exist (ENOENT).
 * Throws YamlParseError for malformed YAML or non-mapping root.
 */
function readCommandsFile(filePath: string): Record<string, unknown> | null {
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
      throw new YamlParseError(filePath, err.linePos?.[0]?.line, err, raw);
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

/**
 * Recursively list all .yml/.yaml files in a directory tree, sorted alphabetically
 * by their full path.
 */
function listYamlFilesRecursive(dirPath: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }
  for (const entry of entries.sort()) {
    const full = join(dirPath, entry);
    try {
      if (statSync(full).isDirectory()) {
        results.push(...listYamlFilesRecursive(full));
      } else if (entry.endsWith('.yml') || entry.endsWith('.yaml')) {
        results.push(full);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return results;
}

/**
 * Merge a source CommandMap into a target, throwing on duplicate aliases.
 * sourceFile is used for error messages.
 */
function mergeCommands(target: Map<string, CommandDef>, source: CommandMap, sourceFile: string): void {
  for (const [alias, def] of source) {
    if (target.has(alias)) {
      throw new CommandSchemaError(alias, `duplicate alias defined in ${sourceFile}`);
    }
    target.set(alias, def);
  }
}

/**
 * Merge source into target, silently overriding duplicates (used for machine → project merge).
 */
function mergeCommandsSilent(target: Map<string, CommandDef>, source: CommandMap): void {
  for (const [alias, def] of source) {
    target.set(alias, def);
  }
}

/**
 * Load all commands from a directory structure (commands.yml + commands/ recursive).
 */
function loadCommandsFromDir(baseDir: string): Map<string, CommandDef> {
  const mainFile = join(baseDir, 'commands.yml');
  const commandsDir = join(baseDir, 'commands');
  const commands = new Map<string, CommandDef>();

  const mainRaw = readCommandsFile(mainFile);
  if (mainRaw) {
    for (const [k, v] of normalizeCommands(mainRaw, mainFile)) {
      commands.set(k, v);
    }
  }

  let dirExists = false;
  try { dirExists = statSync(commandsDir).isDirectory(); } catch { /* */ }
  if (dirExists) {
    for (const filePath of listYamlFilesRecursive(commandsDir)) {
      const raw = readCommandsFile(filePath);
      if (raw === null) continue;
      const fileCommands = normalizeCommands(raw, filePath);
      mergeCommands(commands, fileCommands, filePath);
    }
  }

  return commands;
}

// ---------------------------------------------------------------------------
// CommandsLoader export
// ---------------------------------------------------------------------------

export const commandsLoader: CommandsLoader = {
  async load(cwd: string): Promise<CommandMap> {
    const { dir: machineDir } = resolveMachineConfigDir(); // throws on invalid env
    const projectDir = join(cwd, '.xci');

    // Read project name from config.yml for project-aware machine loading
    let projectName: string | undefined;
    const configPath = join(projectDir, 'config.yml');
    try {
      const raw = readFileSync(configPath, 'utf8');
      const parsed = parse(raw);
      if (parsed && typeof parsed === 'object' && 'project' in parsed && typeof parsed.project === 'string') {
        projectName = parsed.project;
      }
    } catch { /* ignore */ }

    // Start with machine commands from root (lower priority)
    const commands: Map<string, CommandDef> = machineDir
      ? loadCommandsFromDir(machineDir)
      : new Map();

    // Merge machine project-specific commands (override root on duplicates)
    if (machineDir && projectName) {
      const machineProjectDir = join(machineDir, projectName);
      let projDirExists = false;
      try { projDirExists = statSync(machineProjectDir).isDirectory(); } catch { /* */ }
      if (projDirExists) {
        const machineProjectCmds = loadCommandsFromDir(machineProjectDir);
        mergeCommandsSilent(commands, machineProjectCmds);
      }
    }

    // Merge project commands (override machine on duplicates)
    const projectCommands = loadCommandsFromDir(projectDir);
    mergeCommandsSilent(commands, projectCommands);

    if (commands.size === 0) return commands;
    validateGraph(commands);
    return commands;
  },
};
