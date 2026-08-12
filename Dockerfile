# Multi-stage build: compile the client (Vite) and server (tsc) with full
# devDependencies available, then ship only production node_modules + the
# compiled output in a small Alpine runtime image.

FROM node:20-alpine AS build
WORKDIR /app

# Copy just the package manifests first so this layer (the slow one) is
# cached across builds unless dependencies actually change.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY . .
RUN npm run build

# Production node_modules only (no vitest/typescript/tsx/etc). Only the
# server workspace's dependencies are needed at runtime - the client is
# already a static bundle in client/dist.
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --omit=dev --workspace=server

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

# Extracted question-set uploads (server/data/) - not baked into the image,
# but the directory needs to exist for the app to write to at runtime (see
# CLAUDE.md: no volumes mounted by default, this is wiped on every restart).
RUN mkdir -p server/data

EXPOSE 3001
CMD ["node", "server/dist/index.js"]
