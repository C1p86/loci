# Security Audit — Phase 03: Commands Resolver

**Audit Date:** 2026-04-13
**Phase:** 03 — commands-resolver (plans 03-01 and 03-02)
**ASVS Level:** 1
**Auditor:** gsd-secure-phase

---

## Result: SECURED

**Threats Closed:** 9/9
**Threats Open:** 0/9

---

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-03-01 | Denial of Service | mitigate | CLOSED | `src/commands/validate.ts:9` — three-color `Color` type declared; lines 59/87 set gray/black; line 73 checks gray revisit throws `CircularAliasError`; lines 52-57 enforce `depth > 10` cap with chain in `CommandSchemaError` |
| T-03-02 | Tampering | mitigate | CLOSED | `src/commands/normalize.ts:155-156` — else branch rejects null/number/boolean with `CommandSchemaError`; `validateStringArray()` (lines 14-32) rejects non-string array elements; `normalizePlatformBlock()` (lines 57-66) validates platform `cmd` as string or string[] |
| T-03-03 | Information Disclosure | mitigate | CLOSED | All `CommandSchemaError`, `CircularAliasError`, `UnknownAliasError`, and `YamlParseError` constructors in `src/errors.ts` receive only alias names, cycle paths (alias names), file paths, and structural description strings — no config values at any call site in `src/commands/normalize.ts`, `src/commands/validate.ts`, or `src/commands/index.ts` |
| T-03-04 | Tampering | accept | CLOSED | Accepted risk — see Accepted Risks section below |
| T-03-05 | Information Disclosure | mitigate | CLOSED | `src/resolver/interpolate.ts:31-33` — `UndefinedPlaceholderError(key, aliasName)` receives only placeholder key name and alias name; `src/errors.ts:132-138` confirms message template uses `placeholder` and `aliasName`, never the resolved value |
| T-03-06 | Information Disclosure | mitigate | CLOSED | `src/resolver/envvars.ts:25-35` — `redactSecrets()` builds a set of UPPER_UNDERSCORE forms from `secretKeys`, replaces matching env values with `'***'`; comment on line 27 confirms redaction is display-only, real values flow only to Phase 4 env injection |
| T-03-07 | Tampering | mitigate | CLOSED | `src/resolver/interpolate.ts:43-49` — `interpolateArgv` maps each token through `interpolateToken` which returns a `string`; no `split()` or re-tokenization after substitution; token identity is preserved (INT-03 satisfied) |
| T-03-08 | Denial of Service | mitigate | CLOSED | `src/resolver/index.ts:48-53` — `if (depth > 10)` throws `CommandSchemaError` with chain; `depth + 1` passed at recursive call sites on lines 72 and 91 |
| T-03-09 | Information Disclosure | mitigate | CLOSED | All `CommandSchemaError`/`UnknownAliasError` throw sites in `src/resolver/index.ts` (lines 49-53, 57, 93-96) and `src/resolver/platform.ts` (lines 52-56) receive only alias names, OS key names, platform key names, and structural descriptions — no config values |

---

## Accepted Risks

| Threat ID | Category | Component | Justification |
|-----------|----------|-----------|---------------|
| T-03-04 | Tampering | tokenize.ts | Tokenizer splits on whitespace with double-quote preservation and performs no shell metacharacter interpretation. Values from tokenization are argv tokens that will be passed to Phase 4's executor with `shell:false` (EXE-01), making any metacharacters in token values inert. Risk is accepted for Phase 3; Phase 4's `shell:false` enforcement is the boundary control. |

---

## Unregistered Flags

None. All threat surface flags in `03-01-SUMMARY.md` and `03-02-SUMMARY.md` map to registered threat IDs (T-03-01 through T-03-09).

---

## Notes

- The `ShellInjectionError` void-value pattern established in Phase 1 (`src/errors.ts:142-153`) is correctly followed by all Phase 3 error constructors — config values are never passed to or stored in error messages.
- `redactSecrets()` applies dot-notation to UPPER_UNDERSCORE conversion before comparing against `secretKeys`, ensuring the key format mismatch between config (dot-notation) and env vars (UPPER_UNDERSCORE) is handled correctly.
- The D-09 lookup-based alias detection in both `src/commands/validate.ts` and `src/resolver/index.ts` is consistent: `CommandMap.has(step)` is the sole criterion for alias-ref vs inline-command classification.
