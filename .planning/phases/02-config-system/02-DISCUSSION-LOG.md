# Phase 2: Config System - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 02-config-system
**Areas discussed:** Config file structure, Secrets detection, Error UX, Config nesting vs flat

---

## Config File Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Flat keys only | Solo chiavi top-level, placeholder ${KEY} 1:1 | |
| Nested with dot-flatten | Chiavi nested appiattite con dot notation | ✓ |
| Both | Nested parsed, flat override | |

**User's choice:** Nested with dot-flatten
**Notes:** Config files usano struttura YAML nested naturale, il loader appiattisce ricorsivamente in chiavi dot-separated.

---

## Merge Strategy (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Leaf-level merge | Ogni chiave leaf indipendente nel merge | ✓ |
| Object-level replace | Se local definisce un oggetto, tutto l'oggetto viene sostituito | |

**User's choice:** Leaf-level merge
**Notes:** Flatten first, merge second. Override parziale preserva le chiavi non toccate.

---

## Secrets Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Check at load time | git ls-files al caricamento, warning su stderr, non blocca | ✓ |
| Check at load + block option | Come sopra ma con flag strict_secrets per bloccare | |
| Check only on init | Solo durante loci init | |

**User's choice:** Check at load time (warning only)
**Notes:** Skip silenzioso se non in un repo git.

---

## Error UX - YAML Errors

| Option | Description | Selected |
|--------|-------------|----------|
| File + line + message | Nome file, riga, colonna, messaggio del parser | ✓ |
| File + line + snippet | Come sopra + 2-3 righe di contesto dal file | |
| Minimal | Solo nome file e messaggio | |

**User's choice:** File + line + message
**Notes:** La libreria yaml fornisce già line/column — niente snippet parsing extra.

---

## Error UX - Empty Files

| Option | Description | Selected |
|--------|-------------|----------|
| Treat as empty config | File vuoto = nessuna chiave, nessun errore | ✓ |
| Warning + empty config | Come sopra ma con warning | |
| Error | File vuoto è un errore | |

**User's choice:** Treat as empty config (silent)

---

## Config Value Types

| Option | Description | Selected |
|--------|-------------|----------|
| Strings only | ConfigValue = string, coerente col modello env-var | ✓ |
| Strings + arrays | ConfigValue = string | string[] | |
| Any scalar | string | number | boolean | |

**User's choice:** Strings only
**Notes:** Allineato col tipo ConfigValue già definito in types.ts.

---

## Non-String Leaf Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Error with path | Errore esplicito con path dot-notation e tipo trovato | ✓ |
| Stringify silently | Converti in JSON string silenziosamente | |
| Skip with warning | Ignora la chiave e avvisa | |

**User's choice:** Error with path
**Notes:** "deploy.ports: expected string, got array" — chiaro e diagnosticabile.

## Claude's Discretion

- Internal architecture (function vs class vs pipeline)
- Flatten utility as separate export or internal helper
- Test file organization
- execSync vs execa for git ls-files check

## Deferred Ideas

None — discussion stayed within phase scope.
