export interface BuildEmailLinkCtx {
  appBaseUrl: string | undefined;
  headerHost: string | undefined;
}

export function buildEmailLink(
  ctx: BuildEmailLinkCtx,
  path: string,
  queryKey: string,
  queryValue: string,
): string {
  const base = ctx.appBaseUrl ?? `https://${ctx.headerHost ?? 'localhost'}`;
  return `${base}${path}?${queryKey}=${encodeURIComponent(queryValue)}`;
}
