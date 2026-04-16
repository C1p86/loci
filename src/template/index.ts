// src/template/index.ts
//
// `xci template` subcommand — creates a shareable template of the project's .xci/ directory
// with secret values stripped, system config copied, and missing variables listed.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Command } from 'commander';
import { parse, stringify } from 'yaml';

/* ------------------------------------------------------------------ */
/* Helpers                                                               */
/* ------------------------------------------------------------------ */

const SKIP_DIRS = new Set(['template', 'log']);
const SKIP_FILES = new Set(['local.yml', 'local.yaml']);
const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;
const BUILTIN_VARS = new Set(['xci.project.path', 'XCI_PROJECT_PATH', 'XCI_VERBOSE']);

function stripValues(obj: unknown): unknown {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return '';
  if (Array.isArray(obj)) return obj.map(() => '');
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = stripValues(value);
    } else {
      result[key] = '';
    }
  }
  return result;
}

function isSecretsFile(relPath: string): boolean {
  return relPath === 'secrets.yml'
    || relPath === 'secrets.yaml'
    || relPath.startsWith('secrets/');
}

/** A location where a variable is used. */
interface VarUsage {
  file: string;
  line: number;
}

/**
 * Extract placeholders from text with line numbers.
 */
function extractPlaceholdersWithLocations(text: string, filePath: string): Map<string, VarUsage[]> {
  const vars = new Map<string, VarUsage[]>();
  const lines = text.split('\n');
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const lineText = lines[lineNum];
    let m: RegExpExecArray | null;
    const re = new RegExp(PLACEHOLDER_RE.source, 'g');
    while ((m = re.exec(lineText)) !== null) {
      if (m.index > 0 && lineText[m.index - 1] === '$') continue;
      const key = m[1];
      const bracketIdx = key.indexOf('[');
      const base = bracketIdx > 0 ? key.slice(0, bracketIdx) : key;
      const usages = vars.get(base) ?? [];
      usages.push({ file: filePath, line: lineNum + 1 });
      vars.set(base, usages);
    }
  }
  return vars;
}

/**
 * Recursively scan all YAML files and collect placeholder locations.
 */
function scanForPlaceholdersWithLocations(dir: string, baseDir: string): Map<string, VarUsage[]> {
  const allVars = new Map<string, VarUsage[]>();
  if (!existsSync(dir)) return allVars;

  function merge(source: Map<string, VarUsage[]>): void {
    for (const [key, usages] of source) {
      const existing = allVars.get(key) ?? [];
      existing.push(...usages);
      allVars.set(key, existing);
    }
  }

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (SKIP_DIRS.has(entry) && statSync(fullPath).isDirectory()) continue;
    if (SKIP_FILES.has(entry)) continue;

    if (statSync(fullPath).isDirectory()) {
      merge(scanForPlaceholdersWithLocations(fullPath, baseDir));
    } else if (entry.endsWith('.yml') || entry.endsWith('.yaml')) {
      const content = readFileSync(fullPath, 'utf8');
      const relPath = relative(baseDir, fullPath);
      merge(extractPlaceholdersWithLocations(content, relPath));
    }
  }
  return allVars;
}

function flattenKeys(obj: unknown, prefix = ''): Set<string> {
  const keys = new Set<string>();
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return keys;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const k of flattenKeys(value, fullKey)) keys.add(k);
    } else {
      keys.add(fullKey);
    }
  }
  return keys;
}

/**
 * Collect all defined config keys from YAML files in a directory.
 */
function collectDefinedKeysFromDir(dir: string): Set<string> {
  const keys = new Set<string>();
  if (!existsSync(dir)) return keys;

  const scanFiles = (d: string) => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry);
      if (SKIP_DIRS.has(entry)) continue;
      if (statSync(path).isDirectory()) {
        scanFiles(path);
        continue;
      }
      if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
      // Skip command files — we only want config/secrets keys
      const rel = relative(dir, path);
      if (rel.startsWith('commands')) continue;
      try {
        const parsed = parse(readFileSync(path, 'utf8'));
        for (const k of flattenKeys(parsed)) keys.add(k);
      } catch { /* ignore */ }
    }
  };
  scanFiles(dir);
  return keys;
}

/**
 * Build a nested YAML object from dot-notation variable names with empty values.
 */
function buildNestedObject(vars: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const varName of vars) {
    const parts = varName.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part] || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1];
    if (!Object.hasOwn(current, leaf)) {
      current[leaf] = '';
    }
  }
  return obj;
}

/**
 * Recursively copy directory contents, stripping secret values.
 */
function copyDir(
  srcDir: string,
  destDir: string,
  baseDir: string,
  results: { path: string; action: string }[],
): void {
  mkdirSync(destDir, { recursive: true });

  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    const relPath = relative(baseDir, srcPath);

    if (SKIP_DIRS.has(entry) && statSync(srcPath).isDirectory()) continue;
    if (SKIP_FILES.has(entry)) continue;

    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath, baseDir, results);
      continue;
    }

    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) {
      writeFileSync(destPath, readFileSync(srcPath));
      results.push({ path: relPath, action: 'copied' });
      continue;
    }

    if (isSecretsFile(relPath)) {
      const content = readFileSync(srcPath, 'utf8');
      const parsed = parse(content);
      if (parsed && typeof parsed === 'object') {
        const stripped = stripValues(parsed);
        writeFileSync(destPath, stringify(stripped), 'utf8');
        results.push({ path: relPath, action: 'stripped' });
      } else {
        writeFileSync(destPath, content, 'utf8');
        results.push({ path: relPath, action: 'copied' });
      }
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
      results.push({ path: relPath, action: 'copied' });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                            */
/* ------------------------------------------------------------------ */

export function runTemplate(cwd: string): void {
  const xciDir = join(cwd, '.xci');
  if (!existsSync(xciDir)) {
    process.stderr.write("No .xci/ directory found. Run 'xci init' first.\n");
    process.exitCode = 1;
    return;
  }

  // Read project name from config.yml
  const configPath = join(xciDir, 'config.yml');
  let projectName = 'default';
  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, 'utf8');
      const config = parse(configContent);
      if (config && typeof config === 'object' && 'project' in config && typeof config.project === 'string') {
        projectName = config.project;
      }
    } catch { /* ignore */ }
  }

  // Clean previous template
  const templateBase = join(xciDir, 'template');
  if (existsSync(templateBase)) {
    rmSync(templateBase, { recursive: true, force: true });
  }

  const templateDir = join(templateBase, projectName);
  mkdirSync(templateDir, { recursive: true });

  const results: { path: string; action: string }[] = [];

  // 1. Copy project .xci/ files
  copyDir(xciDir, templateDir, xciDir, results);

  // 2. Copy system XCI_MACHINE_CONFIGS/<project>/ to template/sys/ (if exists)
  const machineDir = process.env['XCI_MACHINE_CONFIGS'];
  const sysResults: { path: string; action: string }[] = [];
  if (machineDir) {
    // Copy root machine files
    const sysDestRoot = join(templateDir, 'sys');
    if (existsSync(machineDir)) {
      copyDir(machineDir, sysDestRoot, machineDir, sysResults);
    }
    // Copy project-specific machine files
    const machineProjectDir = join(machineDir, projectName);
    if (existsSync(machineProjectDir)) {
      const sysDestProject = join(sysDestRoot, projectName);
      copyDir(machineProjectDir, sysDestProject, machineProjectDir, sysResults);
    }
  }

  // 3. Scan all sources for placeholders with file:line locations
  const allVarUsages = new Map<string, VarUsage[]>();
  function mergeUsages(source: Map<string, VarUsage[]>, prefix = ''): void {
    for (const [key, usages] of source) {
      const existing = allVarUsages.get(key) ?? [];
      for (const u of usages) {
        existing.push({ file: prefix ? `${prefix}/${u.file}` : u.file, line: u.line });
      }
      allVarUsages.set(key, existing);
    }
  }
  mergeUsages(scanForPlaceholdersWithLocations(xciDir, xciDir));
  if (machineDir && existsSync(machineDir)) {
    mergeUsages(scanForPlaceholdersWithLocations(machineDir, machineDir), '$XCI_MACHINE_CONFIGS');
    const machineProjectDir = join(machineDir, projectName);
    if (existsSync(machineProjectDir)) {
      mergeUsages(scanForPlaceholdersWithLocations(machineProjectDir, machineProjectDir), `$XCI_MACHINE_CONFIGS/${projectName}`);
    }
  }

  // 4. Collect all defined keys from all sources
  const definedKeys = new Set<string>();
  for (const k of collectDefinedKeysFromDir(xciDir)) definedKeys.add(k);
  if (machineDir && existsSync(machineDir)) {
    for (const k of collectDefinedKeysFromDir(machineDir)) definedKeys.add(k);
    const machineProjectDir = join(machineDir, projectName);
    if (existsSync(machineProjectDir)) {
      for (const k of collectDefinedKeysFromDir(machineProjectDir)) definedKeys.add(k);
    }
  }

  // 5. Find missing variables with their usages
  const missingVars: string[] = [];
  const missingUsages = new Map<string, VarUsage[]>();
  for (const [v, usages] of allVarUsages) {
    if (BUILTIN_VARS.has(v)) continue;
    if (definedKeys.has(v)) continue;
    const upper = v.toUpperCase().replace(/[.\-]/g, '_');
    if (definedKeys.has(upper)) continue;
    missingVars.push(v);
    missingUsages.set(v, usages);
  }
  missingVars.sort();

  // 6. Write missing.yml with all undefined variables and usage comments
  if (missingVars.length > 0) {
    const lines: string[] = [
      '# Variables used in commands but not defined in any config file.',
      '# Fill these in or add them to config.yml / secrets.yml as needed.',
      '',
    ];
    for (const v of missingVars) {
      const usages = missingUsages.get(v) ?? [];
      // Write comment with all locations
      for (const u of usages) {
        lines.push(`# used in ${u.file}:${u.line}`);
      }
      // Write the variable as nested YAML
      const parts = v.split('.');
      if (parts.length === 1) {
        lines.push(`${v}: ""`);
      } else {
        // Build nested indentation
        for (let i = 0; i < parts.length - 1; i++) {
          lines.push(`${'  '.repeat(i)}${parts[i]}:`);
        }
        lines.push(`${'  '.repeat(parts.length - 1)}${parts[parts.length - 1]}: ""`);
      }
      lines.push('');
    }
    const missingPath = join(templateDir, 'missing.yml');
    writeFileSync(missingPath, lines.join('\n'), 'utf8');
  }

  // Print summary
  process.stdout.write(`xci template → .xci/template/${projectName}/\n\n`);

  process.stdout.write('  Project files:\n');
  for (const { path, action } of results) {
    const label = action === 'stripped' ? 'stripped' : 'copied  ';
    process.stdout.write(`    ${label}  ${path}\n`);
  }

  if (sysResults.length > 0) {
    process.stdout.write('\n  System files (from $XCI_MACHINE_CONFIGS):\n');
    for (const { path, action } of sysResults) {
      const label = action === 'stripped' ? 'stripped' : 'copied  ';
      process.stdout.write(`    ${label}  sys/${path}\n`);
    }
  }

  if (missingVars.length > 0) {
    process.stdout.write(`\n  Missing variables (written to missing.yml):\n`);
    for (const v of missingVars) {
      process.stdout.write(`    ${v}\n`);
    }
  }

  process.stdout.write('\n');
}

export function registerTemplateCommand(program: Command): void {
  program
    .command('template')
    .description('Generate a shareable template of .xci/ with secrets stripped')
    .action(() => {
      runTemplate(process.cwd());
    });
}
