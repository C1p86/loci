// src/resolver/platform.ts
//
// Platform selection helper and OS key mapping (Phase 3).
// Maps process.platform to user-facing OS keys and selects the correct command for the current OS.

import { CommandSchemaError } from '../errors.js';
import type { CommandDef } from '../types.js';

/** User-facing OS key used in platform override blocks. */
export type OsKey = 'linux' | 'windows' | 'macos';

/**
 * Returns the current OS as a user-facing key.
 * Defaults to 'linux' for unknown platforms.
 */
export function currentOsKey(): OsKey {
  switch (process.platform) {
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      return 'linux';
  }
}

/**
 * Select the effective command argv for a single-kind CommandDef on the current OS.
 *
 * Priority:
 * 1. Platform override for the current OS (if defined)
 * 2. Default cmd (if non-empty)
 * 3. Throws CommandSchemaError if neither applies (D-14 run-time error)
 */
export function selectPlatformCmd(
  def: CommandDef & { kind: 'single' },
  aliasName: string,
): readonly string[] {
  const os = currentOsKey();
  const override = def.platforms?.[os];

  if (override !== undefined) {
    return override;
  }

  if (def.cmd.length > 0) {
    return def.cmd;
  }

  const definedPlatforms = Object.keys(def.platforms ?? {}).join(', ');
  throw new CommandSchemaError(
    aliasName,
    `has no command for ${os} (only ${definedPlatforms} defined)`,
  );
}
