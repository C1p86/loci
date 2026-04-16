// src/version.ts
//
// __XCI_VERSION__ is a build-time constant injected by tsup's `define` option.
// During typecheck (`tsc --noEmit`) it is typed via the declaration below.
// At bundle time, esbuild replaces the identifier with the JSON-quoted version string.
// See tsup.config.ts.
declare const __XCI_VERSION__: string;

export const XCI_VERSION: string = __XCI_VERSION__;
