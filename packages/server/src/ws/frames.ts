// Hand-rolled discriminated union parser for agent frames.
// No zod — minimal deps per CONTEXT D-15 / D-43.
// D-10 discipline: error messages contain type tags only, never token/credential values.

import { AgentFrameInvalidError } from '../errors.js';
import type { AgentIncomingFrame, RunState } from './types.js';

/**
 * Shared RunState-array parser — used by both reconnect and goodbye cases.
 * Phase 10: parses real running_runs entries (Phase 8 goodbye stub replaced).
 */
function parseRunStateArray(input: unknown, fieldLabel: string): RunState[] {
  if (!Array.isArray(input)) {
    throw new AgentFrameInvalidError(`${fieldLabel} not array`);
  }
  return (input as unknown[]).map((r, i) => {
    if (typeof r !== 'object' || r === null) {
      throw new AgentFrameInvalidError(`${fieldLabel}[${i}] not object`);
    }
    const rr = r as Record<string, unknown>;
    if (typeof rr['run_id'] !== 'string') {
      throw new AgentFrameInvalidError(`${fieldLabel}[${i}].run_id not string`);
    }
    return {
      run_id: rr['run_id'] as string,
      status: (rr['status'] as 'running' | 'completed' | 'failed') ?? 'running',
    };
  });
}

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
      const runs = parseRunStateArray(o['running_runs'], 'reconnect.running_runs');
      return {
        type: 'reconnect',
        credential: o['credential'] as string,
        running_runs: runs,
      };
    }

    case 'goodbye': {
      // Phase 10: parse real running_runs (Phase 8 stub [] replaced).
      const runs = parseRunStateArray(o['running_runs'], 'goodbye.running_runs');
      return { type: 'goodbye', running_runs: runs };
    }

    // Phase 10: incoming state frame (agent → server transition ack).
    // Shape: { type:'state', state:'running', run_id:string }
    // NOTE: This is DIFFERENT from the outgoing state frame (server→agent admin push).
    // Outgoing: { type:'state', state:'draining'|'online' } — never parsed here.
    case 'state': {
      if (o['state'] !== 'running') {
        throw new AgentFrameInvalidError(
          `state.state must be 'running', got '${String(o['state'])}'`,
        );
      }
      if (typeof o['run_id'] !== 'string') {
        throw new AgentFrameInvalidError('state.run_id not string (run_id missing or wrong type)');
      }
      return {
        type: 'state',
        state: 'running',
        run_id: o['run_id'] as string,
      };
    }

    // Phase 10: incoming result frame (agent → server execution result).
    case 'result': {
      if (typeof o['run_id'] !== 'string') {
        throw new AgentFrameInvalidError('result.run_id not string');
      }
      if (typeof o['exit_code'] !== 'number' || !Number.isInteger(o['exit_code'])) {
        throw new AgentFrameInvalidError('result.exit_code must be an integer');
      }
      if (typeof o['duration_ms'] !== 'number' || !Number.isInteger(o['duration_ms'])) {
        throw new AgentFrameInvalidError('result.duration_ms must be an integer');
      }
      if (o['cancelled'] !== undefined && typeof o['cancelled'] !== 'boolean') {
        throw new AgentFrameInvalidError('result.cancelled must be boolean if present');
      }
      const result: AgentIncomingFrame & { type: 'result' } = {
        type: 'result',
        run_id: o['run_id'] as string,
        exit_code: o['exit_code'] as number,
        duration_ms: o['duration_ms'] as number,
      };
      if (o['cancelled'] === true) result.cancelled = true;
      return result;
    }

    // Phase 10: incoming log_chunk frame (agent → server streaming; Phase 10 discards, Phase 11 stores).
    case 'log_chunk': {
      if (typeof o['run_id'] !== 'string') {
        throw new AgentFrameInvalidError('log_chunk.run_id not string');
      }
      if (typeof o['seq'] !== 'number' || !Number.isInteger(o['seq']) || (o['seq'] as number) < 0) {
        throw new AgentFrameInvalidError('log_chunk.seq must be a non-negative integer');
      }
      if (o['stream'] !== 'stdout' && o['stream'] !== 'stderr') {
        throw new AgentFrameInvalidError(
          `log_chunk.stream must be 'stdout' or 'stderr', got '${String(o['stream'])}'`,
        );
      }
      if (typeof o['data'] !== 'string') {
        throw new AgentFrameInvalidError('log_chunk.data not string');
      }
      if (typeof o['ts'] !== 'string') {
        throw new AgentFrameInvalidError('log_chunk.ts not string');
      }
      return {
        type: 'log_chunk',
        run_id: o['run_id'] as string,
        seq: o['seq'] as number,
        stream: o['stream'] as 'stdout' | 'stderr',
        data: o['data'] as string,
        ts: o['ts'] as string,
      };
    }

    // dispatch and cancel are server-to-agent only — never valid as incoming frames.
    // A well-behaved agent never sends these; a malicious one attempting to is rejected here.
    case 'dispatch':
    case 'cancel':
      throw new AgentFrameInvalidError(`type ${o['type'] as string} is server-to-agent only`);

    default:
      throw new AgentFrameInvalidError(`unknown type: ${String(o['type'])}`);
  }
}
