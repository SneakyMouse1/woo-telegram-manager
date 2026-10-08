# ==========================================
# STAGE 1: Dependencies cache
# ==========================================
FROM node:20-alpine AS deps

WORKDIR /app

# Install prerequisites for Alpine
RUN apk add --no-cache openssl libc6-compat

# Copy package manifests & prisma schema
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Install dependencies optimized for low-memory VPS
# --progress=false and memory limits prevent OOM-killer (exit code 137)
ENV NODE_OPTIONS="--max-old-space-size=512"
RUN npm ci --prefer-offline --no-audit --no-fund --progress=false

# Generate Prisma Client
RUN npx prisma generate

# ==========================================
# STAGE 2: Source compilation
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

# Reuse dependencies and generated Prisma client from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/
COPY src ./src/

# Compile TypeScript with capped heap to prevent memory spikes on 1GB/2GB VPS
ENV NODE_OPTIONS="--max-old-space-size=512"
RUN npm run build

# Remove development dependencies (prisma CLI remains available in dependencies)
RUN npm prune --omit=dev --no-audit --no-fund --progress=false

# ==========================================
# STAGE 3: Production runtime
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime dependencies (OpenSSL for Prisma engine, dumb-init for signals, wget for healthcheck)
RUN apk add --no-cache openssl libc6-compat dumb-init wget

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
# Restrict runtime heap size to 384MB so Node never exhausts server RAM
ENV NODE_OPTIONS="--max-old-space-size=384"

# Create app directory with proper ownership
RUN chown -R node:node /app

# Copy production artifacts from builder
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node --from=builder /app/src ./src
COPY --chown=node:node --from=builder /app/tsconfig.json ./tsconfig.json
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

# Ensure entrypoint is executable
RUN chmod +x docker-entrypoint.sh

# Use non-root node user
USER node

# Expose default HTTP port
EXPOSE 3000

# Docker healthcheck (with 25s startup grace period for database handshake)
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--", "./docker-entrypoint.sh"]

CMD ["node", "dist/index.js"]
