# Phase 9 Traceability Matrix

Maps each Phase 9 requirement ID to the test files that prove it.

| Requirement | Test File(s) | Plan | Notes |
|-------------|-------------|------|-------|
| TASK-01 | `packages/server/src/routes/tasks/__tests__/create.integration.test.ts` + `packages/xci/src/dsl/__tests__/facade.test.ts` | 09-01 + 09-04 | DSL parity with v1 CLI; valid YAML accepted at save |
| TASK-02 | `packages/xci/src/dsl/__tests__/facade.test.ts` + xci/dsl subpath import verified by server build | 09-01 | Shared parser via `xci/dsl` subpath export; `import { parseYaml } from 'xci/dsl'` |
| TASK-03 | `packages/server/src/db/schema.ts` tasks table + `packages/server/src/repos/__tests__/tasks.isolation.test.ts` + `routes/tasks/__tests__/create.integration.test.ts` | 09-01 + 09-03 + 09-04 | Entity: id, orgId, name, description, yamlDefinition, labelRequirements |
| TASK-04 | `packages/server/src/routes/tasks/__tests__/validation.integration.test.ts` | 09-04 | 4-step D-12 pipeline: parse → structure → cycle → unknown-alias with Levenshtein suggest |
| TASK-05 | OUT OF SCOPE Phase 9 (Phase 13 UI editor) | — | Server-side validate API delivered; UI wiring deferred |
| TASK-06 | `packages/server/src/services/__tests__/dispatch-resolver.test.ts` | 09-06 | Pure fn `resolveTaskParams` — Phase 10 dispatcher wires this at dispatch time |
| SEC-01 | `packages/server/src/crypto/__tests__/secrets.test.ts` (roundtrip) + `routes/secrets/__tests__/create.integration.test.ts` | 09-02 + 09-05 | AES-256-GCM envelope encryption end-to-end |
| SEC-02 | `packages/server/src/crypto/__tests__/secrets.test.ts` (IV-uniqueness assertion) + `routes/secrets/__tests__/update.integration.test.ts` (IV differs after update) | 09-02 + 09-05 | Random 12-byte IV per encrypt call |
| SEC-03 | `packages/server/src/crypto/__tests__/secrets.test.ts` (tag/iv/ciphertext/aad tamper all throw SecretDecryptError) | 09-02 | Auth-tag validation — corruption/tampering → explicit error |
| SEC-04 | `packages/server/src/routes/secrets/__tests__/no-plaintext-leak.integration.test.ts` + CI grep gate on routes/secrets/ | 09-05 | NO endpoint ever returns plaintext value; architectural invariant |
| SEC-05 | `pnpm --filter xci test` suite green (BC-01 / D-40) — packages/xci/ untouched | — | Agent-local `.xci/secrets.yml` wins at agent side; existing v1 code path unchanged |
| SEC-06 | `packages/server/src/services/__tests__/dispatch-resolver.test.ts` (precedence: runOverrides > orgSecrets > unresolved) | 09-06 | Phase 10 full end-to-end dispatch will exercise the agent-local merge |
| SEC-07 | `packages/server/src/routes/secrets/__tests__/audit-log.integration.test.ts` + `delete.integration.test.ts` (tombstone) | 09-05 | Audit log written in same tx as action (D-22); tombstone on delete |
| SEC-08 | `packages/server/src/routes/admin/__tests__/rotate-mek.integration.test.ts` (D-26 plaintext-unchanged + D-28 idempotency) | 09-06 | MEK rotation endpoint — all DEKs re-wrapped atomically, no plaintext change |

## 5 ROADMAP Success Criteria Coverage

| SC | Description | Proving Test(s) | Status |
|----|-------------|-----------------|--------|
| SC1 | Valid YAML accepted; invalid YAML / cyclic alias rejected at save with exact error line and suggestion | `routes/tasks/__tests__/validation.integration.test.ts` | green (09-04) |
| SC2 | Secret creatable as `${SECRET_NAME}`; plaintext NEVER returned by API or log | `routes/secrets/__tests__/no-plaintext-leak.integration.test.ts` | green (09-05) |
| SC3 | Two consecutive encrypts produce different IVs + ciphertexts; both decrypt to original value | `crypto/__tests__/secrets.test.ts` IV-uniqueness test | green (09-02) |
| SC4 | Agent-local `.xci/secrets.yml` wins over org-level secret at dispatch time | v1 xci suite (unchanged, BC-01); Phase 10 wires full dispatch E2E | pending Phase 10 |
| SC5 | MEK rotation re-wraps all org DEKs without changing any plaintext secret value | `routes/admin/__tests__/rotate-mek.integration.test.ts` D-26 roundtrip test | green (09-06) |

## Notes

- SC4 is partially satisfied: the agent-side precedence logic (SEC-06) already exists in the v1 xci codebase (unchanged). The full end-to-end dispatch test (server dispatches → agent resolves → agent-local secrets win) is Phase 10 scope. The unit-level precedence proof is `dispatch-resolver.test.ts`.
- Integration tests (marked "green") run on Linux CI via testcontainers. They are deferred from local execution on Windows/macOS per `vitest.integration.config.ts` design.
- TASK-05 (UI editor) is Phase 13 scope — Phase 9 delivers the server-side validate-on-save API that the editor will call.
