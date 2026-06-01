# syntax=docker/dockerfile:1.7

# ============================================================
# Builder stage — install deps and compile TypeScript to dist/
# ============================================================
FROM node:20-slim AS builder

WORKDIR /app

# Runtime image already ships Chromium under /ms-playwright,
# so skip the postinstall download here to keep the build fast.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install all deps (dev included) for the TypeScript build
COPY package.json package-lock.json ./
RUN npm ci

# Compile src/ -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies so the runtime image stays lean
RUN npm prune --omit=dev


# ============================================================
# Runtime stage — Node 20 + Chromium + all system libs
# Pin the Playwright tag to match the npm package major.minor.
# ============================================================
FROM mcr.microsoft.com/playwright:v1.60.0-jammy AS runtime

ENV NODE_ENV=production \
    DATA_DIR=/data \
    TMP_DIR=/tmp/agent-files

WORKDIR /app

# Copy production deps + compiled output from the builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Pre-create the Railway volume mount point and the file-tool sandbox
RUN mkdir -p /data /tmp/agent-files

CMD ["node", "dist/index.js"]
