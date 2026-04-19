# syntax=docker/dockerfile:1.7

# =============================================================================
# Stage 1: BUILDER — full toolchain, installs deps, runs turbo build, prunes via pnpm deploy.
# node:22 (not slim) so we have build tools for any prebuilt-compile edge case.
# =============================================================================
FROM node:22 AS builder

# Enable corepack + pin pnpm from root package.json packageManager field (D-15 reproducibility)
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /workspace

# Copy lockfile + workspace config FIRST for Docker layer caching (D-14).
# When source changes but deps don't, the install layer is reused.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json biome.json ./
COPY .changeset ./.changeset/
COPY packages/xci/package.json ./packages/xci/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Install full workspace deps (devDeps included — needed for build)
RUN pnpm install --frozen-lockfile

# Now copy source (invalidates later layers, not the install layer above)
COPY packages/xci ./packages/xci
COPY packages/server ./packages/server
COPY packages/web ./packages/web

# Build both @xci/server and @xci/web (turbo handles dependency order)
RUN pnpm turbo run build --filter=@xci/server --filter=@xci/web

# D-03 / D-28: pnpm deploy produces a self-contained node_modules with PROD deps only
# for the server package — no dev deps (no drizzle-kit, no tsx, no testcontainers).
# --legacy flag writes a flat node_modules (no symlinks) that Docker COPY handles cleanly.
RUN pnpm --filter=@xci/server deploy --prod --legacy /deploy

# =============================================================================
# Stage 2: RUNTIME — node:22-slim (glibc; required for @node-rs/argon2 prebuilt) (D-01/D-23)
# =============================================================================
FROM node:22-slim AS runtime

# Install curl for HEALTHCHECK (minimal; slim image lacks it by default).
# Pin via apt-get -y --no-install-recommends to keep layer small.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# D-25: non-root user UID/GID 10001 (uncommon, avoids collisions with host users).
# -M skips creating a home dir; --system uses a low-range UID by default so we pass --uid.
RUN groupadd --system --gid 10001 xci \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin xci

WORKDIR /app

# Copy pruned node_modules + built dist + migrations + web bundle from builder.
# --chown flag sets ownership atomically during COPY (no chmod layer).
COPY --from=builder --chown=xci:xci /deploy/node_modules ./node_modules
COPY --from=builder --chown=xci:xci /deploy/package.json ./package.json
COPY --from=builder --chown=xci:xci /workspace/packages/server/dist ./dist
COPY --from=builder --chown=xci:xci /workspace/packages/server/drizzle ./drizzle
COPY --from=builder --chown=xci:xci /workspace/packages/web/dist ./web

# Fixed env pointing @fastify/static at the bundled web bundle.
# Operator can override via `-e WEB_STATIC_ROOT=''` to disable; default ON in image.
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_STATIC_ROOT=/app/web

USER 10001:10001

EXPOSE 3000

# D-01 HEALTHCHECK — NOTE: endpoint is /api/healthz (NOT /healthz).
# start-period=30s covers boot-time migrations; interval=15s, retries=3.
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=30s \
  CMD curl -fsS http://localhost:3000/api/healthz || exit 1

# D-06 PID 1 signals — node handles SIGTERM/SIGINT natively because server.ts wires
# process.on handlers. Exec form (JSON array) prevents shell wrapper from swallowing signals.
CMD ["node", "dist/server.js"]
