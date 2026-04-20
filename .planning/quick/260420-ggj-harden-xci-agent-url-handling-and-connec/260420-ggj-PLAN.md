---
phase: 260420-ggj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/agent/url.ts
  - packages/xci/src/agent/__tests__/url.test.ts
  - packages/xci/src/agent/index.ts
  - packages/xci/src/agent/client.ts
  - packages/web/src/lib/agentUrl.ts
  - packages/web/src/lib/__tests__/agentUrl.test.ts
  - packages/web/src/routes/agents/AgentsEmptyState.tsx
  - packages/web/src/__tests__/AgentsEmptyState.test.tsx
autonomous: true
requirements:
  - quick-260420-ggj
must_haves:
  truths:
    - "xci --agent accepts http://, https://, ws://, wss://, and bare host:port; emits a single '[agent] connecting to <wss|ws>://host[:port]/ws/agent' line on stderr before opening the socket"
    - "When the WS handshake fails (e.g. DNS miss, connection refused, 404 upgrade), the agent prints '[agent] connect error: <msg>' to stderr for each error event, plus a one-time '[agent] retrying (exponential backoff, max 30s)' notice before the first successful open"
    - "On successful open (and on reconnect), AgentClient prints '[agent] websocket open' to stderr"
    - "packages/web AgentsEmptyState composes the registration command with the canonical WS URL form ending in /ws/agent (scheme auto-promoted https→wss, http→ws)"
    - "xci test suite and web test suite are green; xci build still emits cli.mjs that dynamically imports './agent.mjs' (260420-ezf regression guard)"
  artifacts:
    - path: "packages/xci/src/agent/url.ts"
      provides: "normalizeAgentUrl(raw: string): string — WHATWG-URL-based parser with scheme coercion"
      exports: ["normalizeAgentUrl"]
    - path: "packages/xci/src/agent/__tests__/url.test.ts"
      provides: "vitest coverage of all 11 normalization cases listed in constraints"
      min_lines: 40
    - path: "packages/web/src/lib/agentUrl.ts"
      provides: "buildAgentWsUrl(input: string): string — browser-safe twin of normalizeAgentUrl"
      exports: ["buildAgentWsUrl"]
    - path: "packages/web/src/lib/__tests__/agentUrl.test.ts"
      provides: "vitest coverage of 5 UI-side normalization cases"
      min_lines: 25
  key_links:
    - from: "packages/xci/src/agent/index.ts (runAgent)"
      to: "packages/xci/src/agent/url.ts (normalizeAgentUrl)"
      via: "called after parseFlags, before `new AgentClient(...)`; throws AgentModeArgsError on invalid input"
      pattern: "normalizeAgentUrl\\(flags\\.agent\\)"
    - from: "packages/xci/src/agent/client.ts (AgentClient ctor)"
      to: "process.stderr.write"
      via: "addEventListener('open'|'error') wrappers that log before delegating to opts callbacks"
      pattern: "process\\.stderr\\.write\\(.*agent.*(open|connect error|retrying)"
    - from: "packages/web/src/routes/agents/AgentsEmptyState.tsx"
      to: "packages/web/src/lib/agentUrl.ts (buildAgentWsUrl)"
      via: "import and call with VITE_API_URL ?? window.location.origin"
      pattern: "buildAgentWsUrl\\("
---

<objective>
Harden the xci agent's URL/connection UX with three coordinated fixes, one commit per task:
- **A:** Normalize the --agent argument at startup (canonical `{ws|wss}://host[:port]/ws/agent`) with friendly errors, and emit a single "connecting to …" line before the socket opens.
- **B:** AgentClient logs WebSocket open/error events to stderr so DNS misses, connection refusals, and 404-at-upgrade failures stop appearing as silent hangs.
- **C:** The web dashboard's "register agent" empty state emits the same canonical WS URL, so copy-paste works on the first try.

Purpose: today users who run `xci --agent http://host:3000 --token …` get a silent hang (wrong scheme, wrong path, no stderr). The three changes close that gap end-to-end — the UI produces a correct command, the CLI accepts more shapes and logs what it's doing, and the client logs every connect-error round-trip so users can self-diagnose.

Output:
- `packages/xci/src/agent/url.ts` + unit test file
- Modified `packages/xci/src/agent/{index,client}.ts`
- `packages/web/src/lib/agentUrl.ts` + unit test file
- Modified `packages/web/src/routes/agents/AgentsEmptyState.tsx` and its existing test (assertion updated to reflect canonical URL)
- Three atomic commits (messages prescribed below)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

@packages/xci/src/agent/index.ts
@packages/xci/src/agent/client.ts
@packages/xci/src/errors.ts
@packages/xci/src/agent/__tests__/client.integration.test.ts
@packages/web/src/routes/agents/AgentsEmptyState.tsx
@packages/web/src/__tests__/AgentsEmptyState.test.tsx
@packages/web/vite.config.ts
@packages/server/src/routes/agents/index.ts

<interfaces>
<!-- Extracted from the codebase so the executor has contracts in-hand. -->

From packages/xci/src/errors.ts (line 223):
```ts
export class AgentModeArgsError extends CliError {
  constructor(detail: string);  // Prepends "Agent mode argument error: "
}
```
Import in agent/url.ts with: `import { AgentModeArgsError } from '../errors.js';`
(No circular risk — errors.ts has no imports from agent/.)

From packages/xci/src/agent/index.ts (current shape — around line 176):
```ts
if (!flags.agent) {
  throw new AgentModeArgsError('--agent <url> is required');
}
// ... TOFU + labels + state setup ...
// Line ~322-328 — server_url stored here:
const cred: StoredCredential = {
  version: 1,
  server_url: flags.agent,          // <-- MUST become normalizedUrl
  agent_id: frame.agent_id,
  ...
};
// Line ~412 — client instantiation:
client = new AgentClient({
  url: flags.agent,                 // <-- MUST become normalizedUrl
  onOpen: handleOpen,
  onMessage: handleMessage,
  onClose: handleClose,
});
```

From packages/xci/src/agent/client.ts (current shape):
```ts
export interface AgentClientOptions {
  url: string;
  onOpen: () => void;
  onMessage: (frame: AgentFrame) => void;
  onClose: (code: number, reason: string) => void;
}
// Existing listeners:
this.rws.addEventListener('open',    () => opts.onOpen());
this.rws.addEventListener('message', (e) => { ... opts.onMessage(...) });
this.rws.addEventListener('close',   (e) => opts.onClose(e.code, e.reason));
// NOTE: no 'error' listener today.
```

ReconnectingWebSocket events are DOM-style. The `error` event is a standard `Event`
that may carry a `.message` string (bubbled from ws) or not; fallback to `String(event)`.
The library also emits `open` on every (re)connect, not just the first.

From packages/server/src/routes/agents/index.ts:
```ts
// WS route: GET /ws/agent (HTTP upgrade → WebSocket) — canonical server path.
fastify.get('/ws/agent', { websocket: true }, ...);
```

From packages/web/src/__tests__/AgentsEmptyState.test.tsx (line 82-86):
```ts
// EXISTING ASSERTION (will break after Task C — MUST be updated):
expect(
  screen.getByText(/xci --agent https:\/\/app\.example\.com --token SECRET-TOKEN-123/),
).toBeInTheDocument();
// Must become (wss + /ws/agent):
// /xci --agent wss:\/\/app\.example\.com\/ws\/agent --token SECRET-TOKEN-123/
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task A: URL normalization module + startup log</name>
  <files>
    - packages/xci/src/agent/url.ts (new)
    - packages/xci/src/agent/__tests__/url.test.ts (new)
    - packages/xci/src/agent/index.ts (modified — 3 spots)
  </files>
  <behavior>
    normalizeAgentUrl(raw: string): string
    - 'http://localhost:3000'              → 'ws://localhost:3000/ws/agent'
    - 'https://example.com'                → 'wss://example.com/ws/agent'
    - 'ws://host:8080'                     → 'ws://host:8080/ws/agent'
    - 'wss://host'                         → 'wss://host/ws/agent'
    - 'localhost:3000'                     → 'ws://localhost:3000/ws/agent'
    - 'ws://localhost:3000/ws/agent'       → 'ws://localhost:3000/ws/agent' (idempotent)
    - 'http://localhost:3000/'             → 'ws://localhost:3000/ws/agent'  (trailing slash == no path)
    - 'https://proxy.example.com/custom/agent/path' → 'wss://proxy.example.com/custom/agent/path' (custom reverse-proxy path preserved)
    - ''            → throws AgentModeArgsError
    - 'file:///etc/passwd' → throws AgentModeArgsError
    - 'not a url'          → throws AgentModeArgsError
    - 'javascript:alert(1)' → throws AgentModeArgsError
    Error message MUST include the phrase "valid forms:" and at least these 3 examples:
      "ws://host:3000", "http://host:3000", "wss://example.com"
  </behavior>
  <action>
Step 1 — Create `packages/xci/src/agent/url.ts`:

```ts
import { AgentModeArgsError } from '../errors.js';

const VALID_FORMS_HINT =
  'valid forms: ws://host:3000, http://host:3000, wss://example.com';

/**
 * Normalize a user-provided --agent argument to the canonical WS URL the xci
 * agent uses to connect. Accepts http(s)://, ws(s)://, and bare host:port.
 * Scheme map: https→wss, http→ws, ws/wss preserved, bare → ws.
 * Path rule: missing / empty / "/" → append "/ws/agent"; any other path
 * is preserved verbatim (reverse-proxy setups).
 *
 * Throws AgentModeArgsError on empty input, unparseable input, or any
 * scheme that is not http/https/ws/wss.
 */
export function normalizeAgentUrl(raw: string): string {
  if (!raw || raw.trim() === '') {
    throw new AgentModeArgsError(`--agent URL is empty; ${VALID_FORMS_HINT}`);
  }

  const trimmed = raw.trim();

  // Detect bare "host[:port]" — no "://" at all. Prepend ws:// so WHATWG URL
  // has a scheme to parse.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `ws://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new AgentModeArgsError(
      `--agent URL is not parseable: ${JSON.stringify(raw)}; ${VALID_FORMS_HINT}`,
    );
  }

  // Scheme coercion
  let scheme: 'ws:' | 'wss:';
  switch (parsed.protocol) {
    case 'http:':
    case 'ws:':
      scheme = 'ws:';
      break;
    case 'https:':
    case 'wss:':
      scheme = 'wss:';
      break;
    default:
      throw new AgentModeArgsError(
        `--agent URL has unsupported scheme ${parsed.protocol}; ${VALID_FORMS_HINT}`,
      );
  }

  // Reject URLs with no host (e.g. "file:///etc/passwd" after prefix logic
  // or any parseable URL without a host).
  if (!parsed.host) {
    throw new AgentModeArgsError(
      `--agent URL is missing a host: ${JSON.stringify(raw)}; ${VALID_FORMS_HINT}`,
    );
  }

  // Path handling: empty / "/" → canonical; anything else preserved.
  const rawPath = parsed.pathname;
  const path = rawPath === '' || rawPath === '/' ? '/ws/agent' : rawPath;

  return `${scheme}//${parsed.host}${path}`;
}
```

Step 2 — Create `packages/xci/src/agent/__tests__/url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AgentModeArgsError } from '../../errors.js';
import { normalizeAgentUrl } from '../url.js';

describe('normalizeAgentUrl', () => {
  it.each([
    ['http://localhost:3000',                     'ws://localhost:3000/ws/agent'],
    ['https://example.com',                       'wss://example.com/ws/agent'],
    ['ws://host:8080',                            'ws://host:8080/ws/agent'],
    ['wss://host',                                'wss://host/ws/agent'],
    ['localhost:3000',                            'ws://localhost:3000/ws/agent'],
    ['ws://localhost:3000/ws/agent',              'ws://localhost:3000/ws/agent'],
    ['http://localhost:3000/',                    'ws://localhost:3000/ws/agent'],
    ['https://proxy.example.com/custom/agent/path','wss://proxy.example.com/custom/agent/path'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeAgentUrl(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['file:///etc/passwd'],
    ['javascript:alert(1)'],
    ['not a url'],
  ])('rejects invalid input %j', (bad) => {
    expect(() => normalizeAgentUrl(bad)).toThrow(AgentModeArgsError);
  });

  it('error message includes valid-form hint', () => {
    try {
      normalizeAgentUrl('');
    } catch (e) {
      expect((e as Error).message).toMatch(/ws:\/\/host:3000/);
      expect((e as Error).message).toMatch(/http:\/\/host:3000/);
      expect((e as Error).message).toMatch(/wss:\/\/example\.com/);
      return;
    }
    throw new Error('expected throw');
  });
});
```

Step 3 — Edit `packages/xci/src/agent/index.ts`:

  (a) Add import at top alongside other relative imports:
      `import { normalizeAgentUrl } from './url.js';`

  (b) In `runAgent`, immediately after the existing `if (!flags.agent) { throw ... }`
      guard (around line 178), insert:

      ```ts
      // Normalize to canonical ws(s)://host[:port]/ws/agent form.
      // Throws AgentModeArgsError for unparseable input; propagates through
      // the existing cli.ts catch-all that renders AgentModeArgsError.
      const normalizedUrl = normalizeAgentUrl(flags.agent);
      ```

  (c) Replace `server_url: flags.agent,` (line ~324) with `server_url: normalizedUrl,`.

  (d) Replace `url: flags.agent,` inside `new AgentClient({ ... })` (line ~413) with
      `url: normalizedUrl,`.

  (e) Immediately BEFORE `client = new AgentClient({ ... })` (line ~412), insert:

      ```ts
      process.stderr.write(`[agent] connecting to ${normalizedUrl}\n`);
      ```

  (f) Do NOT touch `printHelp()` — the constraints prohibit modifying --agent help text.

Commit: `feat(xci): normalize agent URL + startup log`
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter xci test -- url</automated>
  </verify>
  <done>
    - url.ts exports normalizeAgentUrl
    - url.test.ts has 8 positive cases (it.each), 5 rejection cases, 1 error-message shape case — all green
    - agent/index.ts: normalizedUrl computed once after the !flags.agent guard; used for server_url, AgentClient url, and the single stderr line
    - Commit `feat(xci): normalize agent URL + startup log` present in git log
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task B: AgentClient logs open + connect-error events</name>
  <files>
    - packages/xci/src/agent/client.ts (modified)
  </files>
  <action>
Edit `packages/xci/src/agent/client.ts`. The file currently has three
addEventListener calls (`open`, `message`, `close`) and no state.

Add:
  1. A private boolean `hasOpenedOnce = false` to distinguish first-open
     from reconnect in the log line.
  2. A private boolean `hasLoggedRetry = false` guarding the one-time
     retry notice.
  3. An `open` listener wrapper that logs `[agent] websocket open` (first time)
     or `[agent] websocket open (reconnected)` (subsequent) to stderr BEFORE
     delegating to `opts.onOpen()`. Set `hasOpenedOnce = true` after log.
     Reset `hasLoggedRetry = false` on every successful open so that a
     subsequent disconnect-then-reconnect cycle can re-emit the retry notice
     if it fails again.
  4. An `error` listener:
     ```ts
     this.rws.addEventListener('error', (event: ErrorEvent) => {
       const msg = event?.message ?? String(event);
       process.stderr.write(`[agent] connect error: ${msg}\n`);
       if (!this.hasOpenedOnce && !this.hasLoggedRetry) {
         process.stderr.write('[agent] retrying (exponential backoff, max 30s)\n');
         this.hasLoggedRetry = true;
       }
     });
     ```
     The ReconnectingWebSocket `ErrorEvent` type from its `events.d.ts` has a
     `message` property; `event?.message` handles runtime variance defensively.

Place the error listener AFTER the open listener and BEFORE the message
listener for readable diffs.

Do NOT change the `AgentClientOptions` interface — callers stay at source
parity. Do NOT add any new onError callback to the interface (would ripple
into index.ts).

Sketch of the modified constructor section:

```ts
export class AgentClient {
  private rws: ReconnectingWebSocket;
  private hasOpenedOnce = false;
  private hasLoggedRetry = false;

  constructor(opts: AgentClientOptions) {
    this.rws = new ReconnectingWebSocket(opts.url, [], { /* unchanged */ });

    this.rws.addEventListener('open', () => {
      if (this.hasOpenedOnce) {
        process.stderr.write('[agent] websocket open (reconnected)\n');
      } else {
        process.stderr.write('[agent] websocket open\n');
        this.hasOpenedOnce = true;
      }
      this.hasLoggedRetry = false;
      opts.onOpen();
    });

    this.rws.addEventListener('error', (event: ErrorEvent) => {
      const msg = (event as { message?: string } | null)?.message ?? String(event);
      process.stderr.write(`[agent] connect error: ${msg}\n`);
      if (!this.hasOpenedOnce && !this.hasLoggedRetry) {
        process.stderr.write('[agent] retrying (exponential backoff, max 30s)\n');
        this.hasLoggedRetry = true;
      }
    });

    this.rws.addEventListener('message', (event: MessageEvent) => { /* unchanged */ });
    this.rws.addEventListener('close',   (event: CloseEvent)   => { /* unchanged */ });
  }
  // send / isOpen / close — unchanged
}
```

**Nice-to-have (optional — skip if ErrorEvent mock proves fiddly):**
Extend `packages/xci/src/agent/__tests__/client.integration.test.ts` with ONE
new `it(...)` that opens an AgentClient against a dead port (e.g. 127.0.0.1:1),
waits ~500ms while spying on `process.stderr.write`, and asserts both
`[agent] connect error:` and `[agent] retrying` appear. If reconnecting-
websocket swallows the error event in vitest's jsdom/node env, drop the
test — the manual smoke captured by Task-A's startup log is sufficient.

**Regression guardrail:** The existing integration test at
`packages/xci/src/agent/__tests__/client.integration.test.ts` does NOT assert
empty stderr; adding always-on stderr writes is safe. Re-run it as part of
verify to confirm.

Commit: `feat(xci): log WS connect errors and open events`
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter xci test -- client.integration</automated>
  </verify>
  <done>
    - client.ts has the two new private booleans + open listener rewrite + new error listener
    - `AgentClientOptions` interface unchanged
    - pnpm --filter xci test (full suite) is green — including client.integration and any new test added
    - Commit `feat(xci): log WS connect errors and open events` present in git log
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task C: UI emits canonical ws://host/ws/agent in registration command</name>
  <files>
    - packages/web/src/lib/agentUrl.ts (new)
    - packages/web/src/lib/__tests__/agentUrl.test.ts (new)
    - packages/web/src/routes/agents/AgentsEmptyState.tsx (modified)
    - packages/web/src/__tests__/AgentsEmptyState.test.tsx (modified — 1 assertion)
  </files>
  <behavior>
    buildAgentWsUrl(input: string): string
    - 'http://localhost:5173'         → 'ws://localhost:5173/ws/agent'
    - 'https://app.example.com'       → 'wss://app.example.com/ws/agent'
    - 'http://localhost:3000/ws/agent'→ 'http://localhost:3000/ws/agent' should normalize to 'ws://localhost:3000/ws/agent' (idempotent on path, scheme coerced)
    - 'http://192.168.1.10:8000'      → 'ws://192.168.1.10:8000/ws/agent'
    - 'http://localhost:3000/custom'  → 'ws://localhost:3000/custom' (preserved)
    Behavior: identical scheme map and path rule as the xci-side helper, but
    this module is BROWSER-SAFE (no imports from node:, no AgentModeArgsError —
    falls back to origin on unparseable input rather than throwing, since the
    UI derives input from window.location.origin or a build-time env var).
  </behavior>
  <action>
Step 1 — Create `packages/web/src/lib/agentUrl.ts`:

```ts
/**
 * Browser-safe companion to packages/xci/src/agent/url.ts#normalizeAgentUrl.
 * Produces the canonical WebSocket URL the xci agent connects to:
 * {ws|wss}://host[:port]/ws/agent.
 *
 * Scheme map: https→wss, http→ws, ws/wss preserved.
 * Path rule: missing / "/" → append "/ws/agent"; any other path preserved
 * (reverse-proxy deployments).
 *
 * On unparseable input, returns the input unchanged so the UI never blows up
 * — the CLI-side normalizer will produce the error if the user pastes it.
 */
export function buildAgentWsUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return input;
  }

  let scheme: 'ws:' | 'wss:';
  switch (parsed.protocol) {
    case 'http:':
    case 'ws:':
      scheme = 'ws:';
      break;
    case 'https:':
    case 'wss:':
      scheme = 'wss:';
      break;
    default:
      return input;
  }

  const rawPath = parsed.pathname;
  const path = rawPath === '' || rawPath === '/' ? '/ws/agent' : rawPath;

  return `${scheme}//${parsed.host}${path}`;
}
```

Step 2 — Create `packages/web/src/lib/__tests__/agentUrl.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildAgentWsUrl } from '../agentUrl.js';

describe('buildAgentWsUrl', () => {
  it.each([
    ['http://localhost:5173',           'ws://localhost:5173/ws/agent'],
    ['https://app.example.com',         'wss://app.example.com/ws/agent'],
    ['http://localhost:3000/ws/agent',  'ws://localhost:3000/ws/agent'],
    ['http://192.168.1.10:8000',        'ws://192.168.1.10:8000/ws/agent'],
    ['http://localhost:3000/custom',    'ws://localhost:3000/custom'],
  ])('%s → %s', (input, expected) => {
    expect(buildAgentWsUrl(input)).toBe(expected);
  });

  it('returns input unchanged on unparseable string', () => {
    expect(buildAgentWsUrl('not a url')).toBe('not a url');
  });
});
```

Step 3 — Edit `packages/web/src/routes/agents/AgentsEmptyState.tsx`:

Add import at the top (alongside the other `../../` imports):
```ts
import { buildAgentWsUrl } from '../../lib/agentUrl.js';
```

Replace the `serverUrl` derivation (current line 13) and the `command`
template (current line 15) so the command uses `buildAgentWsUrl`:

```tsx
// Use VITE_API_URL if set (dev proxy override), else window.location.origin,
// then normalize to the canonical WS URL the xci agent connects to.
const origin =
  (import.meta.env.VITE_API_URL as string | undefined) ?? window.location.origin;
const agentWsUrl = buildAgentWsUrl(origin);

const command = mut.data ? `xci --agent ${agentWsUrl} --token ${mut.data.token}` : null;
```

Keep the rest of the component (JSX, RoleGate, CopyableCommand) untouched.

Step 4 — Update the EXISTING test
`packages/web/src/__tests__/AgentsEmptyState.test.tsx` line 82-86. The mock
sets `window.location.origin = 'https://app.example.com'`, so the command
now becomes `xci --agent wss://app.example.com/ws/agent --token SECRET-TOKEN-123`.
Replace the `expect(screen.getByText(...))` regex:

```ts
// was: /xci --agent https:\/\/app\.example\.com --token SECRET-TOKEN-123/
// now:
expect(
  screen.getByText(/xci --agent wss:\/\/app\.example\.com\/ws\/agent --token SECRET-TOKEN-123/),
).toBeInTheDocument();
```

Do NOT modify any other assertion, mock, or the test's beforeEach.

Commit: `feat(web): UI emits ws://host/ws/agent in registration command`
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter @xci/web test -- agentUrl AgentsEmptyState</automated>
  </verify>
  <done>
    - agentUrl.ts + agentUrl.test.ts created; all 5 mapping cases + 1 unparseable case green
    - AgentsEmptyState.tsx imports buildAgentWsUrl and uses it for the command
    - AgentsEmptyState.test.tsx updated to match the canonical URL; full test file still green
    - Commit `feat(web): UI emits ws://host/ws/agent in registration command` present in git log
  </done>
</task>

<task type="auto">
  <name>Task D: Full verify sweep (no code change — regression + build + typecheck gates)</name>
  <files>
    (none modified)
  </files>
  <action>
Run the full gate set in sequence. Any red stops the plan.

1) xci unit + integration tests (includes the new url.test.ts and the modified
   client.ts):
   ```
   pnpm --filter xci test
   ```

2) @xci/web tests (includes the new agentUrl.test.ts and the updated
   AgentsEmptyState.test.tsx):
   ```
   pnpm --filter @xci/web test
   ```

3) Typecheck both packages:
   ```
   pnpm --filter xci typecheck
   pnpm --filter @xci/web typecheck
   ```

4) Build xci and assert the 260420-ezf regression guard still passes:
   ```
   pnpm --filter xci build
   grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs
   ```
   The grep MUST return >=1 (i.e. the dynamic import string is still present
   in the bundled cli.mjs — proves the tsup external + banner setup from
   260420-ezf is intact).

5) Build @xci/web:
   ```
   pnpm --filter @xci/web build
   ```

No commit — this task is verification only. Task A, B, C commits must already
be in git log by the time this task runs.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter xci test && pnpm --filter @xci/web test && pnpm --filter xci typecheck && pnpm --filter @xci/web typecheck && pnpm --filter xci build && test "$(grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs)" -ge 1 && pnpm --filter @xci/web build</automated>
  </verify>
  <done>
    - All 6 gates green
    - dist/cli.mjs still contains `'./agent.mjs'` dynamic-import string
    - `git log --oneline -n 3` shows the three feature commits from A/B/C in order
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user CLI flag `--agent` | Untrusted string that ultimately gets URL-parsed and passed to the ws/reconnecting-websocket library |
| user browser → UI command builder | Untrusted `window.location.origin` / `VITE_API_URL` string parsed client-side |
| stderr log output | Log lines MUST NOT leak token/credential material |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260420-ggj-01 | T (Tampering) | normalizeAgentUrl (url.ts) | mitigate | WHATWG `URL` parser (no hand-rolled regex for scheme/host); explicit allow-list of schemes (http/https/ws/wss) — file:, javascript:, data:, and anything else throw AgentModeArgsError. |
| T-260420-ggj-02 | I (Info disclosure) | Stderr log lines in client.ts + index.ts | mitigate | Log lines use only `normalizedUrl` (no token — token stays on flags.token and register frame body) and the `event.message` from ws (library-generated text, not agent-controlled). No frame payloads or credentials in stderr. Align with v2.0 decision "Agent token transmitted in WS frame body only, never in connection URL (proxy log safety)". |
| T-260420-ggj-03 | D (Denial of service) | AgentClient retry-notice log | accept | The retry notice fires at most once per `hasOpenedOnce` cycle (boolean guard); reset on each successful open. Unbounded error events from the ws library would produce unbounded `connect error:` lines, but those already occur in the current silent-hang path and are capped by reconnecting-websocket's 30s backoff. Acceptable — this is stderr log volume, not memory pressure. |
| T-260420-ggj-04 | T (Tampering) | buildAgentWsUrl (web) | mitigate | Browser `URL` parser (WHATWG); unparseable input and unsupported schemes return input verbatim so the CLI-side normalizer issues the authoritative error when the user runs the pasted command. Prevents UI-originated URL smuggling (e.g. javascript: in VITE_API_URL at build time) from silently producing a "valid-looking" ws URL. |
| T-260420-ggj-05 | I (Info disclosure) | AgentsEmptyState command string | accept | The registration command contains the one-time registration token by design (user needs to copy-paste it). Existing test (line 89-103) already asserts the token is never written to localStorage/sessionStorage — regression coverage preserved. |
</threat_model>

<verification>
Per-task `<automated>` blocks cover the functional surface. Aggregate sweep in Task D provides the regression guards:
- xci full test suite (includes Phase 8/10/11 integration tests — any URL or client regression surfaces here)
- @xci/web full test suite (includes AgentsEmptyState which now asserts the new URL)
- typecheck both packages (catches any TS slippage from the new imports/types)
- xci build + dist/cli.mjs grep (preserves 260420-ezf fix)
- @xci/web build (proves vite picks up the new lib module)

Manual smoke (optional, not blocking):
- `node packages/xci/dist/cli.mjs --agent http://localhost:9 --token fake-token` should print two stderr lines
  immediately: `[agent] connecting to ws://localhost:9/ws/agent` then (within ~1s) `[agent] connect error: ...` and `[agent] retrying (exponential backoff, max 30s)`.
- `node packages/xci/dist/cli.mjs --agent file:///etc/passwd --token fake` should exit 1 with the AgentModeArgsError message containing "valid forms: ws://host:3000, ...".
</verification>

<success_criteria>
1. `pnpm --filter xci test` green (new url.test.ts passes; client.integration.test.ts still passes).
2. `pnpm --filter @xci/web test` green (new agentUrl.test.ts passes; updated AgentsEmptyState.test.tsx passes).
3. `pnpm --filter xci typecheck` and `pnpm --filter @xci/web typecheck` exit 0.
4. `pnpm --filter xci build` succeeds AND `grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs` ≥ 1.
5. `pnpm --filter @xci/web build` succeeds.
6. Three commits present in git log, in order, with the exact prescribed messages:
   - `feat(xci): normalize agent URL + startup log`
   - `feat(xci): log WS connect errors and open events`
   - `feat(web): UI emits ws://host/ws/agent in registration command`
7. No runtime dependency added to any package.json (verified by `git diff main -- '**/package.json' '**/pnpm-lock.yaml'` showing no change).
8. `packages/xci/tsup.config.ts`, server routes, token/CSRF/auth code, and the `printHelp()` help text are UNCHANGED.
</success_criteria>

<output>
After completion, create `.planning/quick/260420-ggj-harden-xci-agent-url-handling-and-connec/260420-ggj-SUMMARY.md` with:
- What changed (3 bulleted commits)
- Files touched (absolute or monorepo-relative)
- Verify-sweep output snapshot (test counts, build sizes, grep result)
- Any deviations from the plan + rationale
- Pending todos (if the optional AgentClient error-logging vitest was skipped, note why)
</output>
