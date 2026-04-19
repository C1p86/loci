/**
 * D-18: Structural validation of trigger_configs JSONB on task save.
 * Returns a list of TaskValidationDetail; empty array = valid.
 * Caller (create/update route) throws TaskValidationError when length > 0.
 *
 * T-12-04-03: Guards against malformed trigger_configs reaching the DB
 * and later crashing shared-handler during mapToTask evaluation.
 */

import type { TaskValidationDetail } from '../errors.js';

const VALID_GH_EVENTS = ['push', 'pull_request'] as const;
const VALID_PR_ACTIONS = ['opened', 'synchronize', 'closed', 'reopened'] as const;
const MAX_ERRORS = 10;

/**
 * Validates an array of trigger config objects against the TriggerConfig union type.
 *
 * Supported plugins: 'github' | 'perforce'.
 * Unknown plugin names, wrong field types, and invalid enum values all produce errors.
 * Returns up to MAX_ERRORS (10) errors — bounded to prevent output explosion.
 */
export function validateTriggerConfigs(input: unknown): TaskValidationDetail[] {
  const errs: TaskValidationDetail[] = [];
  const push = (d: TaskValidationDetail): void => {
    if (errs.length < MAX_ERRORS) errs.push(d);
  };

  if (!Array.isArray(input)) {
    return [{ message: 'trigger_configs must be an array' }];
  }

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      push({ message: `trigger_configs[${i}] must be an object` });
      continue;
    }

    const cfg = c as Record<string, unknown>;
    const plugin = cfg.plugin;

    if (plugin !== 'github' && plugin !== 'perforce') {
      push({
        message: `trigger_configs[${i}].plugin must be "github" or "perforce" (got ${JSON.stringify(plugin)})`,
        suggestion: 'Supported plugins: github, perforce',
      });
      continue; // Skip further checks — plugin is the discriminant
    }

    if (plugin === 'github') {
      // events: required, non-empty array of valid event names
      if (!Array.isArray(cfg.events) || cfg.events.length === 0) {
        push({ message: `trigger_configs[${i}].events must be a non-empty array of event names` });
      } else {
        for (const e of cfg.events as unknown[]) {
          if (
            typeof e !== 'string' ||
            !VALID_GH_EVENTS.includes(e as (typeof VALID_GH_EVENTS)[number])
          ) {
            push({
              message: `trigger_configs[${i}].events contains invalid event ${JSON.stringify(e)}`,
              suggestion: `Valid events: ${VALID_GH_EVENTS.join(', ')}`,
            });
          }
        }
      }

      // repository: optional string glob
      if (cfg.repository !== undefined && typeof cfg.repository !== 'string') {
        push({ message: `trigger_configs[${i}].repository must be a string glob` });
      }

      // branch: optional string glob
      if (cfg.branch !== undefined && typeof cfg.branch !== 'string') {
        push({ message: `trigger_configs[${i}].branch must be a string glob` });
      }

      // actions: optional array of valid PR action names
      if (cfg.actions !== undefined) {
        if (!Array.isArray(cfg.actions)) {
          push({ message: `trigger_configs[${i}].actions must be an array` });
        } else {
          for (const a of cfg.actions as unknown[]) {
            if (
              typeof a !== 'string' ||
              !VALID_PR_ACTIONS.includes(a as (typeof VALID_PR_ACTIONS)[number])
            ) {
              push({
                message: `trigger_configs[${i}].actions contains invalid action ${JSON.stringify(a)}`,
                suggestion: `Valid actions: ${VALID_PR_ACTIONS.join(', ')}`,
              });
            }
          }
        }
      }
    } else {
      // perforce: depot, user, client are all optional strings
      for (const field of ['depot', 'user', 'client'] as const) {
        const v = cfg[field];
        if (v !== undefined && typeof v !== 'string') {
          push({ message: `trigger_configs[${i}].${field} must be a string` });
        }
      }
    }
  }

  return errs;
}
