# syntax=docker/dockerfile:1.6
# ProBet Production Dockerfile — multi-stage Next.js standalone build
# Optimized for size, layer caching, and AWAXX deployment.

# ───────────────────────────────────────────────────────────────────────────────
# Stage 1: deps — install npm dependencies (cacheable)
# ───────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Install build essentials for native modules (better-sqlite3, etc)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ openssl libssl-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# Project keeps prisma schema at root, not under prisma/. We materialize the
# expected layout so Prisma's default schema lookup works.
COPY schema.prisma ./schema.prisma
COPY migrations ./migrations
COPY prisma-tracking ./prisma-tracking
RUN mkdir -p prisma && cp schema.prisma prisma/schema.prisma

# Install all deps (we need devDeps for the build stage)
# --legacy-peer-deps because @headlessui/react@1.7.18 declares peer react@16-18
# while the project ships react@19. The actual API surface is compatible.
RUN npm install --legacy-peer-deps --no-audit --no-fund

# ───────────────────────────────────────────────────────────────────────────────
# Stage 2: builder — Next.js standalone build
# ───────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Re-install build deps for native modules (Prisma client codegen needs openssl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl libssl-dev \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Materialize the same prisma/ layout the deps stage created (COPY . . from
# host doesn't include it since prisma/ is generated, not committed).
RUN mkdir -p prisma && cp schema.prisma prisma/schema.prisma

ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT_MODE=standalone \
    NODE_ENV=production

# Generate BOTH Prisma clients (legacy SQLite + tracking PostgreSQL),
# then build Next.js. TRACKING_DATABASE_URL is intentionally unset at
# build time — generate only needs the schema file to produce the client.
RUN npx prisma generate \
  && npx prisma generate --schema=prisma-tracking/schema.prisma \
  && npm run build

# ───────────────────────────────────────────────────────────────────────────────
# Stage 3: runner — minimal production image
# ───────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app

# Runtime deps for SQLite + Prisma
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl libssl-dev sqlite3 ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r probet && useradd -r -g probet -u 1001 probet

# Copy standalone build output (includes minimal node_modules + server.js)
COPY --from=builder --chown=probet:probet /app/.next/standalone ./
COPY --from=builder --chown=probet:probet /app/.next/static ./.next/static
# This project has no /public directory; create an empty placeholder so the
# Next standalone server can mount the static dir without 500ing.
RUN mkdir -p /app/public && chown probet:probet /app/public

# Prisma needs the schema + the generated client engine binary
COPY --from=builder --chown=probet:probet /app/prisma ./prisma
COPY --from=builder --chown=probet:probet /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=probet:probet /app/node_modules/@prisma ./node_modules/@prisma

# Probet calibration JSONs and odds k-NN index live under lib/probet — they're
# already bundled into .next via standalone tracing, but copy explicit data
# files for runtime SQLite + analytics.
RUN mkdir -p /app/data && chown -R probet:probet /app/data

USER probet

EXPOSE 5000
ENV NODE_ENV=production \
    PORT=5000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="file:/app/data/probet.db"

# Use dumb-init as PID 1 to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
