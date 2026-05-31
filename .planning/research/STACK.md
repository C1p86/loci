# Technology Stack — v2.1 New Capabilities

**Project:** loci / xci
**Researched:** 2026-06-01
**Scope:** Stack additions for DX-01, SEC-01, SEC-02, GOCLI-06 only.
**Existing stack unchanged:** Node.js 22, TypeScript 5.x, commander.js 14.0.3, execa 9.6.1, yaml 2.8.3, tsup, vitest, biome, Fastify 5, Drizzle, Postgres, React 19, cobra 1.10.2.

---

## 1. Shell Completions — TypeScript xci CLI (DX-01)

### Finding: Commander.js v14 has NO built-in completion API

Confirmed via the commander.js CHANGELOG (v12, v13, v14) and the open GitHub issue #2008 (September 2023, still open): commander.js has never shipped native shell completion generation. No completion feature was added in v14.

**Recommendation: Hand-rolled completion scripts using the existing `--get-completions` mechanism already in the codebase.**

The TypeScript cli.ts already implements:
- `--get-completions` hidden flag that loads the project command map and outputs tab-completion candidates as `name\tdescription` lines
- `xci completion powershell` subcommand that generates a `Register-ArgumentCompleter` block
- `xci install powershell` / `xci uninstall powershell` that patch `$PROFILE`

DX-01 requires extending this to bash/zsh/fish. The pattern is:
1. Add `generateBashScript()`, `generateZshScript()`, `generateFishScript()` functions that emit the shell-specific hook which calls `xci --get-completions xci "$@"` and sources the output
2. Extend `completion [shell]`, `install [shell]`, `uninstall [shell]` to dispatch to the new generators

**No new npm packages required.** The `--get-completions` hook already provides the data layer; the only addition is 3 template strings (bash/zsh/fish scripts) in cli.ts.

### Shell script templates (design sketch)

**Bash** (`~/.bashrc` or `/etc/bash_completion.d/xci`):
```bash
_xci_completions() {
  local words="${COMP_WORDS[*]}"
  local IFS=$'\n'
  COMPREPLY=( $(xci --get-completions $words 2>/dev/null | cut -f1) )
}
complete -F _xci_completions xci
```

**Zsh** (`~/.zshrc` via `compdef` or `$fpath`):
```zsh
_xci() {
  local -a completions
  completions=("${(@f)$(xci --get-completions xci "${words[@]}" 2>/dev/null)}")
  _describe 'xci completions' completions
}
compdef _xci xci
```

**Fish** (`~/.config/fish/completions/xci.fish`):
```fish
function __xci_completions
  xci --get-completions xci (commandline -opc) 2>/dev/null
end
complete -c xci -f -a "(__xci_completions)"
```

**Install paths** (already handled by the existing `install` command pattern):
- Bash: append to `~/.bashrc` or write to `~/.bash_completion.d/xci.bash`
- Zsh: append to `~/.zshrc`
- Fish: write to `~/.config/fish/completions/xci.fish` (idempotent file write, not append)

**No new dependencies.** `node:os`, `node:fs`, `node:path` already in scope.

**Confidence: HIGH** — verified by reading the full cli.ts source. The `--get-completions` data layer is already correct and tested; only shell script templates are missing.

---

## 2. Shell Completions — Go go-xci CLI (DX-01)

### Finding: Cobra has built-in completion generation — zero extra packages

cobra v1.10.2 (already in `go-xci/go.mod`) ships completion generation as a core feature with no additional import. The methods available on `*cobra.Command`:

```go
rootCmd.GenBashCompletion(w io.Writer) error
rootCmd.GenZshCompletion(w io.Writer) error
rootCmd.GenFishCompletion(w io.Writer, includeDesc bool) error
rootCmd.GenPowerShellCompletion(w io.Writer) error
rootCmd.GenPowerShellCompletionWithDesc(w io.Writer) error
```

Cobra also auto-generates a hidden `__complete` command used by all four shells for dynamic completions. If you register `ValidArgs` or `ValidArgsFunction` on a command, cobra handles the rest.

**Recommendation: Use cobra's built-in completion subcommand.**

Add a `completion` subcommand to `go-xci/cmd/root.go`:

```go
completionCmd := &cobra.Command{
    Use:   "completion [bash|zsh|fish|powershell]",
    Short: "Generate shell completion script",
    Args:  cobra.ExactArgs(1),
    RunE: func(cmd *cobra.Command, args []string) error {
        switch args[0] {
        case "bash":
            return root.GenBashCompletion(os.Stdout)
        case "zsh":
            return root.GenZshCompletion(os.Stdout)
        case "fish":
            return root.GenFishCompletion(os.Stdout, true)
        case "powershell":
            return root.GenPowerShellCompletionWithDesc(os.Stdout)
        default:
            return fmt.Errorf("unsupported shell: %s", args[0])
        }
    },
}
rootCmd.AddCommand(completionCmd)
```

For dynamic alias completion (completing project aliases at runtime), use `ValidArgsFunction` on the root command to call the config/commands loader and return alias names. This is the same data already loaded by `printList()`.

**No new Go module dependencies.** cobra is already declared in go.mod.

**Confidence: HIGH** — verified via pkg.go.dev, cobra official docs, go.mod file confirms v1.10.2.

---

## 3. HIBP k-Anonymity Integration (SEC-02)

### Finding: No npm package needed — use Node.js built-in `fetch` + `node:crypto`

The haveibeenpwned Pwned Passwords API:
- **Endpoint:** `GET https://api.pwnedpasswords.com/range/{first5hexChars}`
- **Auth:** None required, no API key, no subscription
- **Rate limit:** None on the Pwned Passwords API
- **Response:** Plain text, one line per suffix: `<HASH_SUFFIX>:<count>\r\n`
- **Always returns HTTP 200** for any valid 5-char hex prefix

The k-anonymity algorithm:
1. SHA-1 hash the plaintext password (`node:crypto`, `createHash('sha1')`)
2. Split into `prefix` (first 5 chars, uppercase) and `suffix` (remaining 35 chars)
3. `GET https://api.pwnedpasswords.com/range/${prefix}`
4. Parse response: split on `\r\n`, split each line on `:`, find matching suffix (case-insensitive)
5. If matched: return `count` (how many times seen in breaches). If 0: not found.

**Recommendation: Implement as a standalone helper in `packages/server/src/crypto/hibp.ts` using `fetch` (available natively in Node.js 18+) and `node:crypto`. Zero new dependencies.**

```typescript
// packages/server/src/crypto/hibp.ts
import { createHash } from 'node:crypto';

export async function checkPwnedPassword(password: string): Promise<number> {
  const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  if (!res.ok) throw new Error(`HIBP API error: ${res.status}`);
  const body = await res.text();
  for (const line of body.split('\r\n')) {
    const [s, count] = line.split(':');
    if (s?.toUpperCase() === suffix) return Number(count);
  }
  return 0;
}
```

**Integration points:**
- `packages/server/src/routes/auth/signup.ts`: call `checkPwnedPassword(req.body.password)` before `signupTx`. If count > 0, return HTTP 422 with a user-visible message.
- `packages/server/src/routes/auth/reset.ts`: call before writing the new password hash.
- Handle network failures gracefully: wrap in try/catch; on error, log a warning and allow the operation to proceed (HIBP is a security enhancement, not a hard gate — failing open is safer than blocking all signups if the API is unreachable).

**Confidence: HIGH** — verified via official HIBP API documentation (haveibeenpwned.com/API/v3). The k-anonymity model is stable and the endpoint is publicly documented.

---

## 4. Session Token Hashing at Rest (SEC-01)

### Finding: `hashToken` already exists — gap is only at the session layer

The `packages/server/src/crypto/tokens.ts` already has:
- `generateToken()` — 256-bit base64url token
- `hashToken(plaintext)` — SHA-256 hex digest (already used for agent credentials and registration tokens via ATOK-06)
- `compareToken(provided, expected)` — timing-safe comparison

The specific debt (D-12): `sessions.id` stores the **raw token** as the primary key (confirmed in `db/schema.ts` line 90 and `repos/sessions.ts`). The raw token is also what gets looked up in `plugins/auth.ts` via `eq(sessions.id, sid)`.

**Recommendation: Store `hashToken(token)` as `sessions.id`, send raw token in the cookie.**

### Implementation pattern

```typescript
// In repos/admin.ts — createSession()
const token = generateToken();          // raw, 43 chars base64url
const tokenHash = hashToken(token);     // sha256 hex, 64 chars
await db.insert(sessions).values({
  id: tokenHash,                         // store hash
  // ...
});
return { token, expiresAt };            // return raw token to caller

// In plugins/auth.ts — onRequest hook
const sid = req.cookies?.xci_sid;       // raw token from cookie
const hash = hashToken(sid);            // hash before lookup
const sessionRows = await db.select().from(sessions)
  .where(and(eq(sessions.id, hash), ...));

// In repos/sessions.ts — findActiveByTokenForOrg, refreshSlidingExpiry, setActiveOrgId
// All callers that take `token: string` must hash before the WHERE clause
```

### No new dependencies — entirely `node:crypto` (already imported in tokens.ts)

### DB migration required

The `sessions.id` column type remains `text PRIMARY KEY`. No column type change. The only migration needed is to clear all existing sessions (they become invalid after hash-at-rest is deployed anyway) or run a Drizzle migration that deletes active sessions. The simpler approach (clear sessions on deploy) avoids a pgcrypto dependency.

**Confidence: HIGH** — the pattern matches exactly what is already done for agent credentials (`credentialHash` column, ATOK-06). Reading the source confirmed the gap.

---

## 5. Colored Terminal Output — Go go-xci (GOCLI-06)

### Finding: fatih/color v1.19.0 — minimal deps, Windows-native, simple API

**Recommended library:** `github.com/fatih/color` v1.19.0

| Criterion | fatih/color | lipgloss v2 |
|-----------|-------------|-------------|
| Primary use case | Inline terminal color | TUI layout engine |
| Transitive deps | 3 (go-colorable, go-isatty, x/sys) | 10+ (termenv, reflow, etc.) |
| Windows support | Yes, via mattn/go-colorable | Yes, via termenv |
| API complexity | Low — `color.Green("text")` | High — style declarations |
| Import path | `github.com/fatih/color` | `github.com/charmbracelet/lipgloss/v2` |
| Latest version | v1.19.0 (Mar 2026) | v2.x (active) |
| NO_COLOR support | Yes (auto-disabled when not a TTY) | Yes |

For xci's use case (colored run headers, step breadcrumbs, pass/fail indicators), fatih/color is the correct choice. lipgloss is a layout engine designed for full TUI applications (tables, boxes, padding, margins) — overkill for coloring a few lines.

**fatih/color transitive dependencies:**
- `github.com/mattn/go-colorable v0.1.14` — enables ANSI on Windows console
- `github.com/mattn/go-isatty v0.0.20` — TTY detection
- `golang.org/x/sys v0.37.0` — syscall wrappers (already a transitive dep of cobra)

All three are mature, minimal, and widely used in the Go CLI ecosystem.

**Installation:**
```bash
cd go-xci && go get github.com/fatih/color@v1.19.0
```

**Usage pattern for GOCLI-06 (run header + step breadcrumbs):**
```go
import "github.com/fatih/color"

var (
    bold  = color.New(color.Bold)
    green = color.New(color.FgGreen, color.Bold)
    red   = color.New(color.FgRed, color.Bold)
    cyan  = color.New(color.FgCyan)
)

// Run header
bold.Fprintf(os.Stderr, "xci: %s\n", alias)

// Step breadcrumb: "  [1/3] step-name"
cyan.Fprintf(os.Stderr, "  [%d/%d] %s\n", i+1, total, stepName)

// Pass/fail
green.Fprintln(os.Stderr, "  ok")
red.Fprintln(os.Stderr, "  FAILED")
```

Use `color.Output` for stdout writes on Windows. Use `os.Stderr` directly with `Fprintf(os.Stderr, ...)` — fatih/color's `Fprintf` routes through the platform-specific colorable writer automatically.

**Confidence: HIGH** — verified via pkg.go.dev, GitHub repo, go.mod inspection. v1.19.0 is the current latest confirmed by pkg.go.dev.

---

## Summary: What Changes

| Capability | New Package | Where | Notes |
|------------|-------------|-------|-------|
| TS completion bash/zsh/fish | None | `packages/xci/src/cli.ts` | 3 template strings + extend existing commands |
| Go completion | None (cobra built-in) | `go-xci/cmd/root.go` | Add `completion` subcommand, ~25 LOC |
| HIBP SEC-02 | None | `packages/server/src/crypto/hibp.ts` | `fetch` + `node:crypto` only |
| Session token hash SEC-01 | None | `repos/admin.ts`, `plugins/auth.ts`, `repos/sessions.ts` | Apply existing `hashToken()` to session layer |
| Go colored output GOCLI-06 | `github.com/fatih/color@v1.19.0` | `go-xci/` | Only new package across all 5 capabilities |

**Total new npm packages: 0**
**Total new Go modules: 1** (`fatih/color` + 3 transitive: go-colorable, go-isatty, x/sys)

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| TS completion | Hand-rolled `--get-completions` | `@gutenye/commander-completion-carapace` | Requires carapace installed separately on user's machine — unacceptable external runtime dependency |
| TS completion | Hand-rolled `--get-completions` | `commander-completion` (npm) | Last updated 2019, non-functional on modern commander per issue #2008 |
| Go completion | cobra built-in | Manual shell scripts | cobra already in go.mod; built-in is always up to date with command structure |
| HIBP | Inline fetch | `pwnedpasswords` npm | Zero-dependency package but adds a transitive dep for ~20 LOC we can write inline; also adds to CLI bundle |
| Session hashing | SHA-256 (`hashToken`) | HMAC-SHA256 | HMAC requires a server-side key that must be stored/rotated; for session token hashing (not password hashing), plain SHA-256 is correct — the token itself is high-entropy random (256-bit), so a MAC key adds no meaningful security benefit |
| Session hashing | SHA-256 | argon2id | argon2id is correct for passwords (low-entropy user input); session tokens are already cryptographically random — argon2id would add 200-400ms latency to every authenticated request with no security gain |
| Go color | fatih/color | lipgloss v2 | lipgloss is a full TUI layout engine (10+ transitive deps); overkill for colored run headers |
| Go color | fatih/color | ANSI escape codes manually | Valid but requires manual NO_COLOR/isatty checks on all platforms including Windows; fatih/color handles all edge cases |

---

## Sources

- commander.js CHANGELOG (v12-v14): https://github.com/tj/commander.js/blob/master/CHANGELOG.md — no completion feature added (HIGH confidence)
- commander.js issue #2008: https://github.com/tj/commander.js/issues/2008 — open, no native completion as of 2025 (HIGH confidence)
- cobra pkg.go.dev: https://pkg.go.dev/github.com/spf13/cobra — v1.10.2, built-in Gen*Completion confirmed (HIGH confidence)
- cobra shell completion docs: https://cobra.dev/docs/how-to-guides/shell-completion/ — bash/zsh/fish/pwsh all supported (HIGH confidence)
- HIBP API v3: https://haveibeenpwned.com/API/v3 — range endpoint, no auth, no rate limit (HIGH confidence)
- fatih/color pkg.go.dev: https://pkg.go.dev/github.com/fatih/color — v1.19.0, Windows via go-colorable (HIGH confidence)
- fatih/color go.mod: https://github.com/fatih/color/blob/main/go.mod — mattn/go-colorable v0.1.14, mattn/go-isatty v0.0.20 (HIGH confidence)
- lipgloss pkg.go.dev: https://pkg.go.dev/github.com/charmbracelet/lipgloss — 10 imports, TUI-focused (HIGH confidence)
- Node.js crypto docs: https://nodejs.org/api/crypto.html — createHash, timingSafeEqual confirmed (HIGH confidence)
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html — token hashing best practices (HIGH confidence)
