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
