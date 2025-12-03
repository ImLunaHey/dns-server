# Multi-stage build for DNS Server
FROM node:22-alpine AS builder

WORKDIR /app

# Copy server files
COPY apps/server/package.json apps/server/pnpm-lock.yaml ./server/
RUN cd server && corepack enable && pnpm install --frozen-lockfile

COPY apps/server/tsconfig.json ./server/
COPY apps/server/src ./server/src

# Build server
RUN cd server && pnpm run build

# Copy client files
COPY apps/client/package.json apps/client/pnpm-lock.yaml ./client/
RUN cd client && corepack enable && pnpm install --frozen-lockfile

COPY apps/client/tsconfig.json apps/client/vite.config.ts apps/client/tailwind.config.js apps/client/postcss.config.js ./client/
COPY apps/client/index.html ./client/
COPY apps/client/src ./client/src

# Build client
RUN cd client && pnpm run build

# Production stage
FROM node:22-alpine

# Install required packages for DNS server
RUN apk add --no-cache \
    ca-certificates \
    tzdata

WORKDIR /app

# Copy built files
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/client/dist ./client/dist

# Create directories for databases and certs
RUN mkdir -p /app/server/certs /app/data

# Expose ports
# 53/udp - DNS
# 53/tcp - DNS over TCP
# 853/tcp - DNS-over-TLS (DoT)
# 853/udp - DNS-over-QUIC (DoQ)
# 3001/tcp - HTTP API and DoH
EXPOSE 53/udp 53/tcp 853/tcp 853/udp 3001/tcp

# Set working directory
WORKDIR /app/server

# Run as non-root user (but note: port 53 requires root or CAP_NET_BIND_SERVICE)
# For production, you may need to run with --cap-add=NET_BIND_SERVICE or as root
USER node

# Start the server
CMD ["node", "dist/index.js"]

