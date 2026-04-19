/**
 * Extract unique ${VAR} placeholder names from a YAML string.
 *
 * Rules:
 * - Matches ${NAME} and ${NAME:default} (default value portion ignored for extraction)
 * - NAME must match [A-Z_][A-Z0-9_]* (uppercase-only, may contain digits and underscores)
 * - Deduplicates: first-encounter order preserved
 *
 * T-13-03-06: extraction is UX-only — server is authoritative for missing params.
 */
export function extractPlaceholders(yaml: string): string[] {
  const rx = /\$\{([A-Z_][A-Z0-9_]*)(?::[^}]*)?\}/g;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of yaml.matchAll(rx)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
