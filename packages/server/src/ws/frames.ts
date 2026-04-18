// Hand-rolled discriminated union parser for agent frames.
// No zod — minimal deps per CONTEXT D-15 / D-43.
// D-10 discipline: error messages contain type tags only, never token/credential values.

import { AgentFrameInvalidError } from '../errors.js';
import type { AgentIncomingFrame, RunState } from './types.js';

export function parseAgentFrame(raw: string): AgentIncomingFrame {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new AgentFrameInvalidError('json');
  }

  if (typeof obj !== 'object' || obj === null) {
    throw new AgentFrameInvalidError('not an object');
  }
  const o = obj as Record<string, unknown>;
  if (typeof o['type'] !== 'string') {
    throw new AgentFrameInvalidError('missing type');
  }

  switch (o['type']) {
    case 'register': {
      if (typeof o['token'] !== 'string') {
        throw new AgentFrameInvalidError('register.token not string');
      }
      if (typeof o['labels'] !== 'object' || o['labels'] === null) {
        throw new AgentFrameInvalidError('register.labels not object');
      }
      const labels = o['labels'] as Record<string, unknown>;
      for (const [k, v] of Object.entries(labels)) {
        if (typeof v !== 'string') {
          throw new AgentFrameInvalidError(`labels.${k} not string`);
        }
      }
      return {
        type: 'register',
        token: o['token'] as string,
        labels: labels as Record<string, string>,
      };
    }

    case 'reconnect': {
      if (typeof o['credential'] !== 'string') {
        throw new AgentFrameInvalidError('reconnect.credential not string');
      }
      if (!Array.isArray(o['running_runs'])) {
        throw new AgentFrameInvalidError('reconnect.running_runs not array');
      }
      // Light validation — RunState entries only need run_id:string for Phase 8 (stub reconciliation)
      const runs: RunState[] = (o['running_runs'] as unknown[]).map((r, i) => {
        if (typeof r !== 'object' || r === null) {
          throw new AgentFrameInvalidError(`running_runs[${i}] not object`);
        }
        const rr = r as Record<string, unknown>;
        if (typeof rr['run_id'] !== 'string') {
          throw new AgentFrameInvalidError(`running_runs[${i}].run_id not string`);
        }
        return {
          run_id: rr['run_id'] as string,
          status: (rr['status'] as 'running' | 'completed' | 'failed') ?? 'running',
        };
      });
      return {
        type: 'reconnect',
        credential: o['credential'] as string,
        running_runs: runs,
      };
    }

    case 'goodbye': {
      if (!Array.isArray(o['running_runs'])) {
        throw new AgentFrameInvalidError('goodbye.running_runs not array');
      }
      // Phase 8: stub — Phase 10 will parse real runs
      return { type: 'goodbye', running_runs: [] };
    }

    // Reserved Phase 10/11 types — parseAgentFrame returns error for them in Phase 8
    case 'dispatch':
    case 'cancel':
    case 'log_chunk':
    case 'result':
      throw new AgentFrameInvalidError(`type ${o['type']} not handled in Phase 8`);

    default:
      throw new AgentFrameInvalidError(`unknown type: ${String(o['type'])}`);
  }
}
