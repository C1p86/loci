/**
 * Plugin registry — D-02, D-03 (PLUG-02 anti-feature: static build-time bundled plugins).
 *
 * Static ES module imports = bundled at build time by tsup. No dynamic import,
 * no filesystem scan, no npm install at runtime. Unknown plugin name → getPlugin returns
 * undefined → route handler returns 404 (WebhookPluginNotFoundError).
 */
import githubPlugin from './github.js';
import perforcePlugin from './perforce.js';
import type { TriggerPlugin } from './types.js';

/**
 * Immutable plugin registry. Keys are the URL path segment used in
 * POST /hooks/{name}/:orgToken routes (Plan 12-03).
 */
export const pluginRegistry: ReadonlyMap<'github' | 'perforce', TriggerPlugin> = new Map([
  ['github', githubPlugin as TriggerPlugin],
  ['perforce', perforcePlugin as TriggerPlugin],
]);

/**
 * O(1) plugin lookup by name. Returns undefined for unknown plugin names
 * so the route handler can throw WebhookPluginNotFoundError (404).
 */
export function getPlugin(name: string): TriggerPlugin | undefined {
  return pluginRegistry.get(name as 'github' | 'perforce');
}

// Re-export all types so callers can import from this single entry point.
export * from './types.js';
