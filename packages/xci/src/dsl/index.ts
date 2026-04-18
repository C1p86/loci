// D-02 public API surface. Consumed by @xci/server via `import … from 'xci/dsl'`.

export { resolvePlaceholders } from './interpolate.js';
export { suggest } from './levenshtein.js';
export type { ParseResult } from './parser.js';
export { parseYaml } from './parser.js';
export type {
  CommandDef,
  CommandMap,
  ParseError,
  PlatformOverrides,
  SequentialStep,
  ValidationError,
} from './types.js';
export type { ValidateResult } from './validate.js';
export { validateAliasRefs, validateCommandMap } from './validate.js';
