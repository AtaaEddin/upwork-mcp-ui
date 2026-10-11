# syntax=docker/dockerfile:1

# ---- build stage ----
FROM node:26-slim AS build
WORKDIR /app

# Build toolchain: compiles native modules (better-sqlite3 has no Node 26
# prebuilds). Build stage only — the runtime image stays slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies first (layer cache)
COPY package.json package-lock.json .npmrc ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY tsconfig.base.json eslint.config.js ./
COPY server server
COPY web web
RUN npm run build

# Drop dev dependencies before copying into the runtime stage
RUN npm prune --omit=dev

# ---- runtime stage ----
FROM node:26-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /data --create-home app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./
COPY --from=build --chown=app:app /app/server/package.json ./server/
COPY --from=build --chown=app:app /app/server/dist ./server/dist
COPY --from=build --chown=app:app /app/web/dist ./web/dist

USER app
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
