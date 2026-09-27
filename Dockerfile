# syntax=docker/dockerfile:1.7
#
# One image, two roles. Hosts that deploy straight from the repository root
# (Temps among them) look for this file and pass no build arguments, so the
# role is chosen at run time by SERVICE:
#
#   SERVICE unset or "web"  → the Next.js standalone server on PORT
#   SERVICE=worker          → migrations, the idempotent seed, then the queues
#
# docker/Dockerfile.web and docker/Dockerfile.worker still build each role on
# its own, smaller image; use those with docker-compose.prod.yml. This one
# trades size for a single build that either service can run.

# ---- base ----
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
# ffmpeg is for the worker's media renditions; openssl for Prisma.
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- build ----
# The whole workspace is copied before installing on purpose. Copying the
# manifests first would cache better, but `COPY packages/*/package.json
# packages/` flattens every manifest onto one path, so pnpm sees a single
# package and never installs the workspace's own dev dependencies: the
# Prisma CLI goes missing and `prisma generate` fails. The pnpm store mount
# keeps reinstalls quick anyway.
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Placeholders only. A build has no request and no secrets: the real values
# arrive in the environment at run time. Without them the env schema refuses
# to load while Next renders any page that reaches for the session.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    AUTH_SECRET=build-time-placeholder-secret-0000 \
    ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
RUN pnpm --filter @platform/database generate \
 && pnpm --filter web build \
 && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static \
 && if [ -d apps/web/public ]; then cp -r apps/web/public apps/web/.next/standalone/apps/web/public; fi

# ---- runtime ----
# The worker needs the workspace and its dev dependencies (tsx, the Prisma
# CLI), so the whole tree is carried over rather than the standalone output
# alone; the web role still runs from that standalone output.
FROM build AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# The worker shells out to pnpm at start-up, and corepack wants a writable
# home for its cache, so the service user gets a real one.
RUN groupadd -r app && useradd -r -m -d /home/app -g app app && chown -R app:app /app /home/app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "if [ \"$SERVICE\" = worker ]; then pnpm --filter @platform/database migrate:deploy && pnpm --filter @platform/database seed && pnpm --filter web worker; else exec node apps/web/.next/standalone/apps/web/server.js; fi"]
