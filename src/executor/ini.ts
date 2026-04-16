// src/executor/ini.ts
//
// INI file manipulation for the `ini` command kind.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface IniSection {
  [key: string]: string;
}

export interface IniData {
  [section: string]: IniSection;
}

/**
 * Parse an INI file into sections. Supports:
 * - [Section] headers (including UE-style [/Script/Module.Class])
 * - Key=Value pairs
 * - Comments (lines starting with ; or #)
 * - +Key=Value (UE array append — stored as +Key)
 */
export function parseIni(content: string): IniData {
  const data: IniData = {};
  let currentSection = '';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue;

    // Section header
    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!data[currentSection]) data[currentSection] = {};
      continue;
    }

    // Key=Value (including +Key=Value for UE array syntax)
    const kvMatch = /^(\+?[^=]+)=(.*)$/.exec(line);
    if (kvMatch && currentSection) {
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();
      if (!data[currentSection]) data[currentSection] = {};
      data[currentSection][key] = value;
    }
  }

  return data;
}

/**
 * Serialize IniData back to INI file content.
 * Uses \r\n line endings (Windows-compatible, required by UE).
 */
export function serializeIni(data: IniData): string {
  const lines: string[] = [];

  for (const [section, keys] of Object.entries(data)) {
    lines.push(`[${section}]`);
    for (const [key, value] of Object.entries(keys)) {
      lines.push(`${key}=${value}`);
    }
    lines.push(''); // blank line between sections
  }

  return lines.join('\r\n');
}

/**
 * Write an INI file. In overwrite mode, replaces the entire file.
 * In merge mode, reads the existing file and merges sections/keys.
 */
export function writeIni(
  filePath: string,
  sections: IniData,
  mode: 'overwrite' | 'merge' = 'overwrite',
): void {
  let data: IniData;

  if (mode === 'merge' && existsSync(filePath)) {
    // Read existing file and merge
    const existing = readFileSync(filePath, 'utf8');
    data = parseIni(existing);
    for (const [section, keys] of Object.entries(sections)) {
      if (!data[section]) data[section] = {};
      for (const [key, value] of Object.entries(keys)) {
        data[section][key] = value;
      }
    }
  } else {
    data = sections;
  }

  // Ensure parent directory exists
  mkdirSync(dirname(filePath), { recursive: true });

  writeFileSync(filePath, serializeIni(data), 'utf8');
}

/**
 * Delete keys from an INI file. If a section becomes empty, it's removed.
 */
export function deleteIniKeys(
  filePath: string,
  deletions: Record<string, string[]>,
): void {
  if (!existsSync(filePath)) return;

  const existing = readFileSync(filePath, 'utf8');
  const data = parseIni(existing);

  for (const [section, keys] of Object.entries(deletions)) {
    if (!data[section]) continue;
    for (const key of keys) {
      delete data[section][key];
    }
    // Remove section if empty
    if (Object.keys(data[section]).length === 0) {
      delete data[section];
    }
  }

  writeFileSync(filePath, serializeIni(data), 'utf8');
}
