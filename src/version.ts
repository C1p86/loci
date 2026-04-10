// src/version.ts
//
// __LOCI_VERSION__ is a build-time constant injected by tsup's `define` option.
// During typecheck (`tsc --noEmit`) it is typed via the declaration below.
// At bundle time, esbuild replaces the identifier with the JSON-quoted version string.
// See tsup.config.ts.
declare const __LOCI_VERSION__: string;

export const LOCI_VERSION: string = __LOCI_VERSION__;
