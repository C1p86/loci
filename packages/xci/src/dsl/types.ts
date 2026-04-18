// D-02: public shape surface for xci/dsl subpath.
// Re-exports from src/types.ts keep a single source of truth.
export type {
  CommandDef,
  CommandMap,
  PlatformOverrides,
  SequentialStep,
} from '../types.js';

export interface ParseError {
  line?: number;
  column?: number;
  message: string;
}

export interface ValidationError {
  message: string;
  suggestion?: string;
}
