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
