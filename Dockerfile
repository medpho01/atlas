# syntax=docker/dockerfile:1.7
# ----------------------------------------------------------------------------
# Atlas — multi-stage build
#   1. deps     — install ALL deps (incl. devDependencies) for build step
#   2. builder  — run `next build` producing .next/standalone
#   3. runner   — minimal alpine image, non-root, runs the standalone server
#
# Image size: ~160 MB (vs ~900 MB without the standalone output).
# ----------------------------------------------------------------------------

# ---- 1. deps ---------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
# libc6-compat: bcryptjs is pure JS but next-swc needs it on Alpine.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 2. builder ------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Telemetry off — keeps build logs clean and avoids the postinstall ping.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 3. runner -------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3010
ENV HOSTNAME=0.0.0.0

# Run as non-root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the standalone server output. It contains a trimmed node_modules with
# only what's needed at runtime. `.next/static` and `public` are NOT included
# in standalone, so we copy them separately.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

USER nextjs
EXPOSE 3010

# Healthcheck hits the cheap /api/health route (SELECT 1 against the DB).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3010/api/health || exit 1

CMD ["node", "server.js"]
