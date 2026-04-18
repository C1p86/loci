// src/executor/capture.ts
//
// Capture validation: type coercion and assertion evaluation.

import type { CaptureConfig } from '../types.js';

export interface CaptureValidationResult {
  valid: boolean;
  error?: string;
  coerced: string; // the value after trim (always a string for env injection)
}

/**
 * Validate a captured value against a CaptureConfig.
 * Returns { valid: true, coerced } on success, { valid: false, error } on failure.
 */
export function validateCapture(raw: string, config: CaptureConfig): CaptureValidationResult {
  const trimmed = raw.trim();
  const typeName = config.type ?? 'string';

  // Type coercion + validation
  let numericValue: number | undefined;
  switch (typeName) {
    case 'string':
      break;
    case 'int': {
      const n = Number(trimmed);
      if (trimmed === '' || !Number.isFinite(n) || !Number.isInteger(n)) {
        return { valid: false, error: `expected int, got "${trimmed}"`, coerced: trimmed };
      }
      numericValue = n;
      break;
    }
    case 'float': {
      const n = Number(trimmed);
      if (trimmed === '' || !Number.isFinite(n)) {
        return { valid: false, error: `expected float, got "${trimmed}"`, coerced: trimmed };
      }
      numericValue = n;
      break;
    }
    case 'json': {
      if (trimmed === '') {
        return { valid: false, error: 'expected JSON, got empty string', coerced: trimmed };
      }
      try {
        JSON.parse(trimmed);
      } catch {
        const preview = trimmed.length > 50 ? trimmed.slice(0, 50) + '...' : trimmed;
        return { valid: false, error: `expected valid JSON, got "${preview}"`, coerced: trimmed };
      }
      break;
    }
  }

  // Assertions
  if (config.assert) {
    const assertions = typeof config.assert === 'string' ? [config.assert] : config.assert;
    for (const assertion of assertions) {
      const result = evaluateAssertion(assertion, trimmed, numericValue);
      if (!result.pass) {
        return { valid: false, error: result.reason, coerced: trimmed };
      }
    }
  }

  return { valid: true, coerced: trimmed };
}

// ---------------------------------------------------------------------------
// Assertion evaluator
// ---------------------------------------------------------------------------

interface AssertResult {
  pass: boolean;
  reason?: string;
}

function evaluateAssertion(
  assertion: string,
  value: string,
  numericValue: number | undefined,
): AssertResult {
  const a = assertion.trim();

  // "not empty"
  if (a === 'not empty') {
    return value.length > 0
      ? { pass: true }
      : { pass: false, reason: 'value is empty' };
  }

  // "not null" (same as not empty for captured stdout)
  if (a === 'not null') {
    return value.length > 0
      ? { pass: true }
      : { pass: false, reason: 'value is null/empty' };
  }

  // "valid json"
  if (a === 'valid json') {
    if (value.length === 0) {
      return { pass: false, reason: 'expected valid JSON, got empty string' };
    }
    try {
      JSON.parse(value);
      return { pass: true };
    } catch {
      const preview = value.length > 50 ? value.slice(0, 50) + '...' : value;
      return { pass: false, reason: `expected valid JSON, got "${preview}"` };
    }
  }

  // "valid json or empty"
  if (a === 'valid json or empty') {
    if (value.length === 0) return { pass: true };
    try {
      JSON.parse(value);
      return { pass: true };
    } catch {
      const preview = value.length > 50 ? value.slice(0, 50) + '...' : value;
      return { pass: false, reason: `expected valid JSON or empty, got "${preview}"` };
    }
  }

  // "empty"
  if (a === 'empty') {
    return value.length === 0
      ? { pass: true }
      : { pass: false, reason: `expected empty, got "${value}"` };
  }

  // Comparison operators: >= <= > < == !=
  const compMatch = /^(>=|<=|>|<|==|!=)\s*(.+)$/.exec(a);
  if (compMatch) {
    const op = compMatch[1];
    const rhs = compMatch[2].trim();

    // Try numeric comparison if both sides are numbers
    if (numericValue !== undefined) {
      const rhsNum = Number(rhs);
      if (Number.isFinite(rhsNum)) {
        return numericCompare(op, numericValue, rhsNum, a);
      }
    }

    // String comparison (strip surrounding quotes if present)
    const rhsStr = rhs.replace(/^['"]|['"]$/g, '');
    return stringCompare(op, value, rhsStr, a);
  }

  // "matches /regex/"
  const regexMatch = /^matches\s+\/(.+)\/([gimsuy]*)$/.exec(a);
  if (regexMatch) {
    try {
      const re = new RegExp(regexMatch[1], regexMatch[2]);
      return re.test(value)
        ? { pass: true }
        : { pass: false, reason: `"${value}" does not match /${regexMatch[1]}/${regexMatch[2]}` };
    } catch {
      return { pass: false, reason: `invalid regex in assertion: ${a}` };
    }
  }

  return { pass: false, reason: `unknown assertion: "${a}"` };
}

function numericCompare(op: string, lhs: number, rhs: number, expr: string): AssertResult {
  let pass = false;
  switch (op) {
    case '>':  pass = lhs > rhs; break;
    case '<':  pass = lhs < rhs; break;
    case '>=': pass = lhs >= rhs; break;
    case '<=': pass = lhs <= rhs; break;
    case '==': pass = lhs === rhs; break;
    case '!=': pass = lhs !== rhs; break;
  }
  return pass
    ? { pass: true }
    : { pass: false, reason: `assertion failed: ${lhs} ${expr}` };
}

function stringCompare(op: string, lhs: string, rhs: string, expr: string): AssertResult {
  let pass = false;
  switch (op) {
    case '==': pass = lhs === rhs; break;
    case '!=': pass = lhs !== rhs; break;
    default:
      return { pass: false, reason: `operator "${op}" requires numeric values, got string "${lhs}"` };
  }
  return pass
    ? { pass: true }
    : { pass: false, reason: `assertion failed: "${lhs}" ${expr}` };
}
