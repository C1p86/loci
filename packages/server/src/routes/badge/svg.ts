// Phase 13 D-29: Badge SVG template (shields.io-compatible, 100x20, inline — no templating lib).

export type BadgeState = 'passing' | 'failing' | 'unknown';

const COLORS: Record<BadgeState, string> = {
  passing: '#4c1', // bright green (shields.io compat)
  failing: '#e05d44', // red
  unknown: '#9f9f9f', // grey
};

const LABEL = 'xci';

/**
 * Renders a 100x20 shields.io-compatible SVG badge.
 * Left pill: dark grey "xci" label (40px). Right pill: colored state text (60px).
 * Font: Verdana 11px (shields.io default) via <text> with scaled coordinates.
 * Output is safe: state is one of 3 known literals, never user input.
 */
export function renderBadgeSvg(state: BadgeState): string {
  const color = COLORS[state];
  const message = state; // 'passing' | 'failing' | 'unknown'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20" role="img" aria-label="${LABEL}: ${message}">
  <title>${LABEL}: ${message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="100" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="40" height="20" fill="#555"/>
    <rect x="40" width="60" height="20" fill="${color}"/>
    <rect width="100" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-rendering="geometricPrecision">
    <text x="20" y="15" fill="#010101" fill-opacity=".3">${LABEL}</text>
    <text x="20" y="14">${LABEL}</text>
    <text x="70" y="15" fill="#010101" fill-opacity=".3">${message}</text>
    <text x="70" y="14">${message}</text>
  </g>
</svg>`;
}
