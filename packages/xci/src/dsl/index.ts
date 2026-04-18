// D-02 public API surface. Consumed by @xci/server via `import … from 'xci/dsl'`.
export { parseYaml } from './parser.js';
export type { ParseResult } from './parser.js';
export { validateCommandMap, validateAliasRefs } from './validate.js';
export type { ValidateResult } from './validate.js';
export { resolvePlaceholders } from './interpolate.js';
export { suggest } from './levenshtein.js';
export type {
  CommandDef,
  CommandMap,
  ParseError,
  PlatformOverrides,
  SequentialStep,
  ValidationError,
} from './types.js';
