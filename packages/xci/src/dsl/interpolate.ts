// D-05 + D-32: dispatch-time interpolation reuses v1 INT-02 engine, lenient mode.
// Unknown ${VAR} left as-is so the agent can merge .xci/secrets.yml (SEC-06).
export { interpolateArgvLenient as resolvePlaceholders } from '../resolver/interpolate.js';
